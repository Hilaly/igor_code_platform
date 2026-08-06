import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";
import type { PluginRouteRequest } from "@sovereign/sdk";

import { createContributionRegistry } from "./contribution-registry.ts";
import { createPluginRoutes } from "./plugin-routes.ts";
import type { PluginCall, PluginCallResult } from "./plugin-wire.ts";
import type { PluginCallOutcome } from "./plugin-supervisor.ts";
import { createDispatcher } from "../http/public.ts";
import { createLogger } from "../platform/public.ts";

const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const plugin = { key: "data:tasks", id: "tasks", source: "data" as const };

type Answer = { status: number; headers: Record<string, string | undefined>; body: Buffer };

type ServeOptions = {
  answer?: (call: PluginCall) => PluginCallOutcome | Promise<PluginCallOutcome>;
  session?: boolean;
  requestsPerMinute?: number;
  bodyLimitBytes?: number;
};

async function serve(
  contributions: Parameters<ReturnType<typeof createContributionRegistry>["apply"]>[1],
  options: ServeOptions = {},
) {
  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });
  const registry = createContributionRegistry();
  const calls: PluginCall[] = [];

  registry.apply(plugin, contributions, new Set());

  const routes = createPluginRoutes({
    registry,
    plugins: {
      call: async (_key, call) => {
        calls.push(call);

        return (
          (await options.answer?.(call)) ??
          ({ kind: "value", value: { body: "ok" } } satisfies PluginCallResult)
        );
      },
    },
    logger,
    timeoutMilliseconds: () => 1000,
    bodyLimitBytes: () => options.bodyLimitBytes ?? 1024,
    requestsPerMinute: () => options.requestsPerMinute ?? 60,
  });

  const server = createServer(
    createDispatcher({
      routes: [],
      logger,
      authenticate: () =>
        options.session === false ? { kind: "none" } : { kind: "session", id: "the-session" },
      pluginRoutes: () => routes.routes(),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (
    method: string,
    path: string,
    body?: string,
    headers: Record<string, string> = {},
  ): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        { host: "127.0.0.1", port, method, path, headers },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers as Record<string, string | undefined>,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end(body);
    });

  return { call, calls, records, routes };
}

describe("the routes of a plugin", () => {
  it("answers at /p/<plugin>/<path> with what the worker returned", async () => {
    const { call, calls } = await serve(
      [{ kind: "route", id: "board", method: "GET", path: "board/:boardId" }],
      {
        answer: () => ({
          kind: "value",
          value: {
            status: 201,
            headers: { "content-type": "application/json" },
            body: '{"id":"7"}',
          },
        }),
      },
    );

    const answer = await call("GET", "/p/tasks/board/7?full=yes", undefined, { accept: "*/*" });

    assert.equal(answer.status, 201);
    assert.equal(answer.headers["content-type"], "application/json");
    assert.equal(answer.body.toString("utf8"), '{"id":"7"}');

    const request = (calls[0] as { request: PluginRouteRequest }).request;

    // Адрес — идентификатор плагина, а объявленный путь и параметры едут в воркер как есть.
    assert.equal(request.path, "board/:boardId");
    assert.deepEqual(request.parameters, { boardId: "7" });
    assert.deepEqual(request.query, { full: "yes" });
    assert.equal(request.headers["accept"], "*/*");
    assert.equal(request.public, false);
    // Идентификатор вклада в вызове — объявленный: им же ключуется таблица обработчиков в воркере.
    assert.equal((calls[0] as { contributionId: string }).contributionId, "board");
  });

  it("hands the body over as bytes, without reading it as json", async () => {
    const { call, calls } = await serve([
      { kind: "public-route", id: "hook", method: "POST", path: "webhooks/github" },
    ]);

    await call("POST", "/p/tasks/webhooks/github", "не json вовсе", {
      "content-type": "text/plain",
    });

    const request = (calls[0] as { request: PluginRouteRequest }).request;

    assert.deepEqual(request.body, new Uint8Array(Buffer.from("не json вовсе")));
    assert.equal(request.public, true);
  });

  it("needs a session on an ordinary route and none on a public one", async () => {
    const routes = [
      { kind: "route" as const, id: "board", method: "GET" as const, path: "board" },
      { kind: "public-route" as const, id: "hook", method: "GET" as const, path: "hook" },
    ];
    const { call } = await serve(routes, { session: false });

    assert.equal((await call("GET", "/p/tasks/board")).status, 401);
    assert.equal((await call("GET", "/p/tasks/hook")).status, 200);
  });

  it("refuses a public route called too often, and keeps counting per contribution", async () => {
    const { call, records } = await serve(
      [
        { kind: "public-route", id: "hook", method: "GET", path: "hook" },
        { kind: "public-route", id: "other", method: "GET", path: "other" },
      ],
      { requestsPerMinute: 2 },
    );

    assert.equal((await call("GET", "/p/tasks/hook")).status, 200);
    assert.equal((await call("GET", "/p/tasks/hook")).status, 200);

    const refused = await call("GET", "/p/tasks/hook");

    assert.equal(refused.status, 429);
    assert.deepEqual(JSON.parse(refused.body.toString("utf8")), {
      error: "too many requests to this route",
    });
    // Сосед считается отдельно: чужой вебхук не имеет права закрыть доступ соседнему.
    assert.equal((await call("GET", "/p/tasks/other")).status, 200);
    assert.ok(records.some((record) => record.message.includes("called too often")));
  });

  it("tells the journal that the call came from outside", async () => {
    const { call, records } = await serve([
      { kind: "route", id: "board", method: "GET", path: "board" },
      { kind: "public-route", id: "hook", method: "GET", path: "hook" },
    ]);

    await call("GET", "/p/tasks/board");
    await call("GET", "/p/tasks/hook");

    const calls = records.filter((record) => record.message === "a route of a plugin was called");

    assert.deepEqual(
      calls.map((record) => record["access"]),
      ["session", "public"],
    );
    // Вызов извне записан вместе с адресом вызывающего, а вызов из интерфейса — без него.
    assert.equal(calls[0]?.["caller"], undefined);
    assert.ok(calls[1]?.["caller"]);
  });

  it("answers 504 when the plugin did not answer in time and 500 when it broke", async () => {
    const { call } = await serve(
      [
        { kind: "route", id: "slow", method: "GET", path: "slow" },
        { kind: "route", id: "broken", method: "GET", path: "broken" },
      ],
      {
        answer: (made) =>
          (made as { contributionId: string }).contributionId === "slow"
            ? { kind: "timed-out", waitedMilliseconds: 1000 }
            : { kind: "failed", reason: "the handler threw at line 12 of the plugin" },
      },
    );

    const late = await call("GET", "/p/tasks/slow");
    const broken = await call("GET", "/p/tasks/broken");

    assert.equal(late.status, 504);
    assert.equal(broken.status, 500);
    // Подробности остаются в журнале: наружу они не идут ни на одном из двух исходов.
    assert.ok(!broken.body.toString("utf8").includes("line 12"));
  });

  it("keeps the headers of the server to itself and refuses a status that is not a status", async () => {
    const { call, records } = await serve(
      [
        { kind: "route", id: "greedy", method: "GET", path: "greedy" },
        { kind: "route", id: "odd", method: "GET", path: "odd" },
      ],
      {
        answer: (made) =>
          (made as { contributionId: string }).contributionId === "greedy"
            ? {
                kind: "value",
                value: { headers: { "content-length": "9999", "x-mine": "yes" }, body: "коротко" },
              }
            : { kind: "value", value: { status: 99 } },
      },
    );

    const greedy = await call("GET", "/p/tasks/greedy");
    const odd = await call("GET", "/p/tasks/odd");

    assert.equal(greedy.status, 200);
    assert.equal(greedy.headers["x-mine"], "yes");
    // Длину считает сервер: плагин, назвавший её сам, оборвал бы ответ на середине.
    assert.equal(greedy.headers["content-length"], String(Buffer.byteLength("коротко")));
    assert.equal(greedy.body.toString("utf8"), "коротко");
    assert.equal(greedy.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(odd.status, 500);
    assert.ok(records.some((record) => record.message.includes("that is not a status")));
  });

  it("gives the address to nobody when two contributions claim it", async () => {
    const { call, records } = await serve([
      { kind: "route", id: "first", method: "GET", path: "board" },
      { kind: "route", id: "second", method: "GET", path: "board" },
    ]);

    // Спор за адрес разрешается как спор за идентификатор вклада: не применяется ни один.
    assert.equal((await call("GET", "/p/tasks/board")).status, 404);
    assert.ok(
      records.some((record) => record.message.includes("claimed by several contributions")),
    );
  });

  it("drops the route of a contribution the human switched off", async () => {
    const registry = createContributionRegistry();
    const logger = createLogger({ source: "core", level: () => "error", write: () => {} });
    const routes = createPluginRoutes({
      registry,
      plugins: { call: async () => ({ kind: "value", value: {} }) },
      logger,
      timeoutMilliseconds: () => 1000,
      bodyLimitBytes: () => 1024,
      requestsPerMinute: () => 60,
    });
    const declared = [
      { kind: "route" as const, id: "board", method: "GET" as const, path: "board" },
    ];

    registry.apply(plugin, declared, new Set());
    assert.deepEqual(
      routes.routes().map((route) => route.path),
      ["/p/tasks/board"],
    );

    // Таблица пересобирается по ревизии реестра: выключенный вклад уносит свой адрес с собой.
    registry.apply(plugin, declared, new Set(["tasks.board"]));
    assert.deepEqual(routes.routes(), []);
  });
});

it("rebuilds the table when the limit of the body changed, not only when the registry did", async () => {
  const registry = createContributionRegistry();
  const logger = createLogger({ source: "core", level: () => "error", write: () => {} });
  let bodyLimitBytes = 64;
  const routes = createPluginRoutes({
    registry,
    plugins: { call: async () => ({ kind: "value", value: {} }) },
    logger,
    timeoutMilliseconds: () => 1000,
    bodyLimitBytes: () => bodyLimitBytes,
    requestsPerMinute: () => 60,
  });

  registry.apply(
    plugin,
    [{ kind: "route", id: "board", method: "POST", path: "board" }],
    new Set(),
  );

  assert.equal(routes.routes()[0]?.bodyLimitBytes, 64);

  // Правка `config.json` ревизию реестра не двигает, а предел лежит в строке таблицы: без этого
  // маршрут отвечал бы прежним пределом до следующей перезагрузки плагина.
  bodyLimitBytes = 128;

  assert.equal(routes.routes()[0]?.bodyLimitBytes, 128);
});
