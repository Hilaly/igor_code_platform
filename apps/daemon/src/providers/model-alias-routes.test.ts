import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import { emptyEnvironment, inMemoryVault } from "@sovereign/agent-runtime-pi/testing";
import {
  aliasProviderId,
  coreEventTypes,
  modelAliasPath,
  modelAliasesPath,
  type BusEvent,
  type ModelAlias,
  type ModelAliasesSnapshot,
} from "@sovereign/protocol";

import { createDispatcher } from "../http/public.ts";
import { createEventBus, createLogger, ensureDataDirectory } from "../platform/public.ts";
import { modelAliasRoutes } from "./model-alias-routes.ts";
import { createModelAliasStore, modelAliasesFileName } from "./model-alias-store.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-model-alias-routes-"));
const servers: Server[] = [];

after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  rmSync(workspace, { recursive: true, force: true });
});

const alias = (): ModelAlias => ({
  id: "opus-5",
  name: "Opus 5",
  candidates: [
    { providerId: "anthropic", modelId: "claude-opus-4-5" },
    { providerId: "openai", modelId: "gpt-5" },
  ],
});

async function serve(contents?: string) {
  const directory = ensureDataDirectory(mkdtempSync(join(workspace, "case-")));

  if (contents !== undefined) {
    writeFileSync(join(directory, modelAliasesFileName), contents);
  }

  const logger = createLogger({ source: "core", level: () => "debug", write: () => undefined });
  const catalogue = createProviderCatalogue({
    credentials: inMemoryVault(),
    environment: emptyEnvironment(),
  });
  const bus = createEventBus({ onListenerError: () => undefined });
  const events: BusEvent[] = [];

  bus.subscribe((event) => events.push(event));

  const store = createModelAliasStore({ directory, logger });

  catalogue.setAliases(store.list());

  const server = createServer(
    createDispatcher({
      routes: modelAliasRoutes({ store, catalogue, bus, logger }),
      logger,
      authenticate: () => ({ kind: "session", id: "one" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const port = (server.address() as AddressInfo).port;
  const call = (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> =>
    new Promise((resolve, reject) => {
      const request = sendRequest(
        { host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json" } },
        (response) => {
          let text = "";

          response.setEncoding("utf8");
          response.on("data", (chunk: string) => (text += chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              body: text === "" ? undefined : JSON.parse(text),
            }),
          );
        },
      );

      request.on("error", reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });

  return { call, catalogue, events };
}

describe("the model alias HTTP API", () => {
  it("creates an alias and puts it into the catalogue at once", async () => {
    const { call, catalogue, events } = await serve();

    assert.equal((await call("POST", modelAliasesPath, alias())).status, 200);

    // Выбранный человеком алиас обязан появиться в пикере сразу, а не после перезапуска демона.
    assert.deepEqual(
      catalogue.modelsOf(aliasProviderId)?.map((model) => model.id),
      ["opus-5"],
    );
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providersChanged],
    );
  });

  it("reads, replaces and removes one alias", async () => {
    const { call, catalogue } = await serve();

    await call("POST", modelAliasesPath, alias());

    const listed = (await call("GET", modelAliasesPath)).body as ModelAliasesSnapshot;

    assert.deepEqual(listed.aliases, [alias()]);

    const renamed = { ...alias(), name: "Опус пятый" };

    assert.equal((await call("PUT", modelAliasPath("opus-5"), renamed)).status, 200);
    assert.deepEqual(
      catalogue.modelsOf(aliasProviderId)?.map((model) => model.name),
      ["Опус пятый"],
    );

    assert.deepEqual((await call("DELETE", modelAliasPath("opus-5"))).body, { id: "opus-5" });
    // Ушёл последний алиас — ушёл и провайдер: строка, за которой ничего нет, человеку не нужна.
    assert.equal(catalogue.modelsOf(aliasProviderId), undefined);
  });

  it("refuses to change the identifier of an alias", async () => {
    const { call } = await serve();

    await call("POST", modelAliasesPath, alias());

    // Идентификатор — часть ссылки на модель в сессиях: смена имени оборвала бы их молча.
    const answer = await call("PUT", modelAliasPath("opus-5"), { ...alias(), id: "opus-6" });

    assert.equal(answer.status, 409);
  });

  it("refuses a draft it cannot read", async () => {
    const { call } = await serve();

    assert.equal((await call("POST", modelAliasesPath, { ...alias(), id: "Opus 5" })).status, 400);
    assert.equal(
      (await call("POST", modelAliasesPath, { ...alias(), candidates: [] })).status,
      400,
    );
    assert.equal(
      (
        await call("POST", modelAliasesPath, {
          ...alias(),
          candidates: [{ providerId: aliasProviderId, modelId: "opus-5" }],
        })
      ).status,
      400,
    );
  });

  it("refuses a taken identifier instead of replacing the alias behind it", async () => {
    const { call } = await serve();

    await call("POST", modelAliasesPath, alias());

    assert.equal((await call("POST", modelAliasesPath, alias())).status, 409);
  });

  it("answers 404 for an alias nobody made", async () => {
    const { call } = await serve();

    assert.equal(
      (await call("PUT", modelAliasPath("opus-9"), { ...alias(), id: "opus-9" })).status,
      404,
    );
    assert.equal((await call("DELETE", modelAliasPath("opus-9"))).status, 404);
  });

  it("refuses to write over a file it could not read, and says so in the snapshot", async () => {
    const { call } = await serve("{ это не json");
    const snapshot = (await call("GET", modelAliasesPath)).body as ModelAliasesSnapshot;

    assert.match(snapshot.problem ?? "", /model-aliases\.json/);
    assert.equal((await call("POST", modelAliasesPath, alias())).status, 409);
  });
});
