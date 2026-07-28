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
import { createLogger } from "./logger.ts";

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
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (method: string, path: string, body?: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest({ host: "127.0.0.1", port, method, path }, (incoming) => {
        let text = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          text += chunk;
        });
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text }),
        );
      });

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
    const { call } = await serve([{ ...echo("/api/session"), access: "open" }], withoutSession);

    assert.equal((await call("GET", "/api/session")).status, 200);
  });

  it("tells the handler which session asked", async () => {
    const { call } = await serve([echo("/api/plugins")]);

    assert.deepEqual(JSON.parse((await call("GET", "/api/plugins")).body).session, {
      id: "the-session",
    });
  });

  it("gives an open route no session when there is none", async () => {
    const { call } = await serve([{ ...echo("/api/session"), access: "open" }], withoutSession);

    assert.equal(JSON.parse((await call("GET", "/api/session")).body).session, undefined);
  });

  it("gives an open route the session when there is one", async () => {
    // Открытый маршрут обязан различать вошедшего и невошедшего: `GET /api/session` только этим и
    // занимается.
    const { call } = await serve([{ ...echo("/api/session"), access: "open" }]);

    assert.deepEqual(JSON.parse((await call("GET", "/api/session")).body).session, {
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
