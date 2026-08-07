import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as sendRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";

import {
  createDispatcher,
  respondWithJson,
  type Authentication,
  type Route,
} from "./dispatcher.ts";
import { createLogger } from "../platform/public.ts";

type Answer = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

type ServeOptions = {
  bodyLimitBytes?: number;
  /** По умолчанию сессия есть: тесты маршрутизации не про вход. */
  authenticate?: (request: IncomingMessage) => Authentication;
  /** Второй источник строк таблицы: маршруты плагинов появляются и исчезают на живом демоне. */
  pluginRoutes?: () => Route[];
};

async function serve(routes: Route[], options: ServeOptions = {}) {
  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });

  const server = createServer(
    createDispatcher({
      routes,
      logger,
      authenticate: options.authenticate ?? (() => ({ kind: "session", id: "the-session" })),
      ...(options.bodyLimitBytes === undefined ? {} : { bodyLimitBytes: options.bodyLimitBytes }),
      ...(options.pluginRoutes === undefined ? {} : { pluginRoutes: options.pluginRoutes }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  /**
   * По умолчанию запрос выглядит как запрос интерфейса: свой `content-type` у изменяющих методов и
   * `Sec-Fetch-Site: same-origin`. Отсутствие того и другого — отдельные тесты.
   */
  const call = (
    method: string,
    path: string,
    body?: string,
    headers: Record<string, string> | undefined = undefined,
  ): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: headers ?? (method === "GET" ? {} : { "content-type": "application/json" }),
        },
        (incoming) => {
          let text = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            text += chunk;
          });
          incoming.on("end", () =>
            resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end(body);
    });

  return { call, records };
}

const echo = (path: string, method: Route["method"] = "GET"): Route => ({
  method,
  path,
  handle: ({ response, parameters, body, session }) =>
    respondWithJson(response, 200, { parameters, body, session }),
});

const withoutSession = { authenticate: (): Authentication => ({ kind: "none" }) };

describe("createDispatcher", () => {
  it("picks the route by method and path", async () => {
    const { call } = await serve([echo("/api/health"), echo("/api/plugins", "PUT")]);

    const answer = await call("GET", "/api/health");

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body).parameters, {});
  });

  it("reads a parameter out of the path", async () => {
    const { call } = await serve([echo("/api/plugins/:key/preferences", "PUT")]);

    const answer = await call("PUT", "/api/plugins/data%3Ahello/preferences", "{}");

    assert.deepEqual(JSON.parse(answer.body).parameters, { key: "data:hello" });
  });

  it("ignores the query string when matching", async () => {
    const { call } = await serve([echo("/api/events")]);

    assert.equal((await call("GET", "/api/events?lastEventId=7")).status, 200);
  });

  it("answers an unknown path with a json 404", async () => {
    const { call } = await serve([echo("/api/health")]);

    const answer = await call("GET", "/api/nothing");

    assert.equal(answer.status, 404);
    assert.equal(answer.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(answer.body), { error: "not found" });
  });

  it("tells a known path with a wrong method apart from an unknown path", async () => {
    const { call } = await serve([echo("/api/plugins"), echo("/api/plugins", "PUT")]);

    const answer = await call("DELETE", "/api/plugins");

    assert.equal(answer.status, 405);
    assert.equal(answer.headers["allow"], "GET, PUT");
  });

  it("refuses a body larger than the limit before reading it whole", async () => {
    const { call } = await serve([echo("/api/plugins", "PUT")], { bodyLimitBytes: 64 });

    const answer = await call("PUT", "/api/plugins", JSON.stringify({ pad: "x".repeat(1_000) }));

    assert.equal(answer.status, 413);
  });

  it("refuses a body that is not json", async () => {
    const { call } = await serve([echo("/api/plugins", "PUT")]);

    const answer = await call("PUT", "/api/plugins", "{ enabled: true");

    assert.equal(answer.status, 400);
    assert.match(JSON.parse(answer.body).error, /not valid json/);
  });

  it("passes a parsed body to the handler and undefined when there is none", async () => {
    const { call } = await serve([echo("/api/plugins", "PUT")]);

    assert.deepEqual(
      JSON.parse((await call("PUT", "/api/plugins", '{"enabled":true}')).body).body,
      {
        enabled: true,
      },
    );
    assert.equal(JSON.parse((await call("PUT", "/api/plugins")).body).body, undefined);
  });

  it("answers 500 and writes down why when the handler throws", async () => {
    const { call, records } = await serve([
      {
        method: "GET",
        path: "/api/boom",
        handle: () => {
          throw new Error("the handler is broken");
        },
      },
    ]);

    const answer = await call("GET", "/api/boom");

    assert.equal(answer.status, 500);
    assert.deepEqual(JSON.parse(answer.body), { error: "internal error" });

    const failure = records.find((record) => record.message === "the request handler failed");

    assert.equal(failure?.level, "error");
    assert.equal(failure?.["path"], "/api/boom");
    assert.match(String(failure?.["reason"]), /the handler is broken/);
  });

  it("refuses a route without a session", async () => {
    const { call } = await serve([echo("/api/plugins")], withoutSession);

    const answer = await call("GET", "/api/plugins");

    assert.equal(answer.status, 401);
    assert.deepEqual(JSON.parse(answer.body), { error: "the request needs a session" });
  });

  it("answers an open route without a session", async () => {
    // Открытость называется полем, а его отсутствие значит «нужна сессия»: забытое поле делает
    // маршрут защищённым, а не открытым (docs/web-api.md).
    const { call } = await serve(
      [{ ...echo("/api/login-session"), access: "open" }],
      withoutSession,
    );

    assert.equal((await call("GET", "/api/login-session")).status, 200);
  });

  it("tells the handler which session asked", async () => {
    const { call } = await serve([echo("/api/plugins")]);

    assert.deepEqual(JSON.parse((await call("GET", "/api/plugins")).body).session, {
      id: "the-session",
    });
  });

  it("gives an open route no session when there is none", async () => {
    const { call } = await serve(
      [{ ...echo("/api/login-session"), access: "open" }],
      withoutSession,
    );

    assert.equal(JSON.parse((await call("GET", "/api/login-session")).body).session, undefined);
  });

  it("gives an open route the session when there is one", async () => {
    // Открытый маршрут обязан различать вошедшего и невошедшего: `GET /api/login-session` только этим и
    // занимается.
    const { call } = await serve([{ ...echo("/api/login-session"), access: "open" }]);

    assert.deepEqual(JSON.parse((await call("GET", "/api/login-session")).body).session, {
      id: "the-session",
    });
  });

  it("checks the session before it reads the body", async () => {
    const { call } = await serve([echo("/api/plugins", "PUT")], {
      ...withoutSession,
      bodyLimitBytes: 64,
    });

    // Тело без сессии не читается вовсе: буферизовать килобайты для того, кто получит отказ, — это
    // ровно та трата памяти, от которой защищает лимит.
    const answer = await call("PUT", "/api/plugins", JSON.stringify({ pad: "x".repeat(1_000) }));

    assert.equal(answer.status, 401);
  });

  it("answers an unknown path with 404 even without a session", async () => {
    // Таблица маршрутов ядра — публичный контракт (docs/public-contract.md), скрывать её от
    // невошедшего незачем, а разница между «нет адреса» и «не тот метод» полезна и до входа.
    const { call } = await serve([echo("/api/plugins")], withoutSession);

    assert.equal((await call("GET", "/api/nothing")).status, 404);
    assert.equal((await call("DELETE", "/api/plugins")).status, 405);
  });

  it("refuses a changing request the browser calls cross-site", async () => {
    // Маршрут регистрации открыт по необходимости, и `SameSite=Strict` его не защищает: чужая
    // страница ничего не читает, но отправить запрос может. `Sec-Fetch-Site` ставит браузер, и
    // подделать его страница не может (docs/web-api.md).
    const { call } = await serve([{ ...echo("/api/account", "POST"), access: "open" }]);

    const answer = await call("POST", "/api/account", "{}", {
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
    });

    assert.equal(answer.status, 403);
    assert.match(JSON.parse(answer.body).error, /cross-site/);
  });

  it("lets a same-origin request through and asks nothing of curl", async () => {
    const { call } = await serve([echo("/api/plugins", "PUT")]);

    assert.equal(
      (
        await call("PUT", "/api/plugins", "{}", {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        })
      ).status,
      200,
    );

    // У запроса вне браузера заголовка нет вовсе, и это не повод отказывать: без него запрос не
    // может быть межсайтовым.
    assert.equal(
      (await call("PUT", "/api/plugins", "{}", { "content-type": "application/json" })).status,
      200,
    );
  });

  it("refuses a changing request that does not call itself json", async () => {
    // Второй замок на ту же дверь: `Sec-Fetch-Site` есть не у всякого браузера, а `text/plain`
    // делает запрос «простым» — он уходит без предзапроса, и CORS его не останавливает. С
    // `application/json` предзапрос обязателен, и мы на него не отвечаем.
    const { call } = await serve([{ ...echo("/api/account", "POST"), access: "open" }]);

    const answer = await call("POST", "/api/account", "{}", { "content-type": "text/plain" });

    assert.equal(answer.status, 415);
    assert.match(JSON.parse(answer.body).error, /application\/json/);

    assert.equal((await call("POST", "/api/account", "{}", {})).status, 415);
  });

  it("takes the parameters of a json content type in stride", async () => {
    const { call } = await serve([echo("/api/plugins", "PUT")]);

    assert.equal(
      (
        await call("PUT", "/api/plugins", "{}", {
          "content-type": "Application/JSON; charset=utf-8",
        })
      ).status,
      200,
    );
  });

  it("asks no content type of a request that carries no body", async () => {
    // У `GET` и `DELETE` тела нет по определению, и требовать от них `content-type` значило бы
    // требовать заголовок про то, чего нет. Межсайтовость у `DELETE` проверяется всё равно.
    const { call } = await serve([echo("/api/login-session", "DELETE")]);

    assert.equal((await call("DELETE", "/api/login-session", undefined, {})).status, 200);
    assert.equal(
      (await call("DELETE", "/api/login-session", undefined, { "sec-fetch-site": "cross-site" }))
        .status,
      403,
    );
  });

  it("waits for an asynchronous handler", async () => {
    const { call } = await serve([
      {
        method: "GET",
        path: "/api/slow",
        handle: async ({ response }) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          respondWithJson(response, 200, { done: true });
        },
      },
    ]);

    assert.deepEqual(JSON.parse((await call("GET", "/api/slow")).body), { done: true });
  });
});

describe("the second source of table rows", () => {
  it("keeps core routes and plugin routes apart under the shared /api root", async () => {
    // Маршруты плагинов живут под `/api/p/`, потому что `/p/` целиком отдан их страницам
    // (docs/ui-extension-model.md). Общий корень безопасен, пока `p` не второй сегмент маршрута
    // ядра: за этим следит тест протокола, а здесь проверяется, что диспетчер их не путает.
    const { call } = await serve([echo("/api/plugins/:key/preferences", "PUT")], {
      pluginRoutes: () => [echo("/api/p/tasks/board/:id")],
    });

    const core = await call("PUT", "/api/plugins/tasks/preferences", "{}");
    const plugin = await call("GET", "/api/p/tasks/board/7");

    assert.deepEqual(JSON.parse(core.body).parameters, { key: "tasks" });
    assert.deepEqual(JSON.parse(plugin.body).parameters, { id: "7" });
  });

  it("prefers a literal segment over a parameter segment", async () => {
    const { call } = await serve([], {
      pluginRoutes: () => [
        { ...echo("/api/p/tasks/items/:id"), access: "public" },
        { ...echo("/api/p/tasks/items/new"), access: "public" },
      ],
    });

    const answer = await call("GET", "/api/p/tasks/items/new");

    assert.deepEqual(JSON.parse(answer.body).parameters, {});
  });

  it("routes to a plugin route and stops routing to it once it is gone", async () => {
    let routes: Route[] = [echo("/api/p/tasks/board")];
    const { call } = await serve([echo("/api/health")], { pluginRoutes: () => routes });

    assert.equal((await call("GET", "/api/p/tasks/board")).status, 200);

    // Перезагруженный плагин уносит свои строки с собой: устаревший обработчик, который продолжает
    // отвечать, — худший исход (docs/web-api.md, «Почему так»).
    routes = [];

    assert.equal((await call("GET", "/api/p/tasks/board")).status, 404);
  });

  it("keeps the session check on an ordinary route of a plugin", async () => {
    const { call } = await serve([], {
      ...withoutSession,
      pluginRoutes: () => [echo("/api/p/tasks/board")],
    });

    // Защита не в обработчике, поэтому маршрут чужого кода не может оказаться незащищённым
    // случайно (docs/web-api.md).
    assert.equal((await call("GET", "/api/p/tasks/board")).status, 401);
  });

  it("answers a public route of a plugin without a session and without the form checks", async () => {
    const { call } = await serve([], {
      ...withoutSession,
      pluginRoutes: () => [
        { ...echo("/api/p/tasks/webhook", "POST"), access: "public", body: "raw" },
      ],
    });

    // Ни cookie, ни `application/json`: у публичного маршрута нет сессии, которую эти проверки
    // защищают, а `content-type` чужого вебхука платформе не принадлежит.
    const answer = await call("POST", "/api/p/tasks/webhook", "подписанный текст", {
      "content-type": "text/plain",
    });

    assert.equal(answer.status, 200);
    // Тело не разбирается как json: его форму знает только автор маршрута.
    assert.deepEqual(JSON.parse(answer.body).body, {
      type: "Buffer",
      data: [...Buffer.from("подписанный текст")],
    });
  });

  it("closes a request whose body does not arrive before the route deadline", async () => {
    let handled = false;
    const server = createServer(
      createDispatcher({
        routes: [
          {
            method: "POST",
            path: "/api/slow-body",
            body: "raw",
            bodyReadTimeoutMilliseconds: 10,
            handle: () => {
              handled = true;
            },
          },
        ],
        logger: createLogger({ source: "core", level: () => "error", write: () => {} }),
        authenticate: () => ({ kind: "session", id: "session" }),
      }),
    );

    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const startedAt = Date.now();
    const outcome = await new Promise<{ kind: "closed" | "answered"; status?: number }>(
      (resolve) => {
        const request = sendRequest(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: "/api/slow-body",
            headers: { "content-length": "100", "content-type": "application/json" },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve({ kind: "answered", status: response.statusCode }));
          },
        );

        request.on("error", () => resolve({ kind: "closed" }));
        request.write("partial");
        setTimeout(() => request.end("body"), 30).unref();
      },
    );

    assert.ok(Date.now() - startedAt >= 5);
    assert.ok(outcome.kind === "closed" || outcome.status === 408 || outcome.status === 400);
    assert.equal(handled, false);
  });

  it("keeps the form checks on an open route of the core", async () => {
    const { call } = await serve([{ ...echo("/api/account", "POST"), access: "open" }], {
      ...withoutSession,
    });

    // Открытый маршрут ядра работает по cookie, которую он сам и выдаёт: на нём оба замка
    // обязательны, и это единственное, что защищает чистый демон (docs/web-api.md).
    assert.equal(
      (await call("POST", "/api/account", "{}", { "content-type": "text/plain" })).status,
      415,
    );
    assert.equal(
      (
        await call("POST", "/api/account", "{}", {
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        })
      ).status,
      403,
    );
  });

  it("gives a plugin route its own limit of the body", async () => {
    const { call } = await serve([echo("/api/plugins", "PUT")], {
      bodyLimitBytes: 16,
      pluginRoutes: () => [
        { ...echo("/api/p/tasks/webhook", "POST"), bodyLimitBytes: 1024, body: "raw" },
      ],
    });

    const long = "a".repeat(64);

    assert.equal((await call("PUT", "/api/plugins", JSON.stringify(long))).status, 413);
    assert.equal((await call("POST", "/api/p/tasks/webhook", long)).status, 200);
  });
});

it("contains body-read failures instead of creating an unhandled rejection", async () => {
  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });
  const response = {
    headersSent: false,
    destroyed: true,
    destroy: () => {},
  } as unknown as import("node:http").ServerResponse;
  const request = {
    method: "POST",
    url: "/api/body",
    headers: { "content-type": "application/json" },
    socket: { remoteAddress: "127.0.0.1" },
    [Symbol.asyncIterator](): AsyncIterator<Buffer> {
      return {
        next: async () => {
          throw new Error("aborted");
        },
      };
    },
  } as unknown as IncomingMessage;
  const dispatch = createDispatcher({
    routes: [{ ...echo("/api/body", "POST") }],
    logger,
    authenticate: () => ({ kind: "session", id: "session" }),
  });

  dispatch(request, response);
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(records.some((record) => record.message.includes("request handling failed")));
});
