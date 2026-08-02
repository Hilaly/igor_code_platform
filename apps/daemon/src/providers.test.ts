import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import { emptyEnvironment } from "@sovereign/agent-runtime-pi/testing";
import {
  coreEventTypes,
  providerCredentialPath,
  providerModelsPath,
  providersPath,
  providersRefreshPath,
  type BusEvent,
  type ProviderModels,
  type ProviderSummary,
  type ProvidersSnapshot,
  type RefreshReport,
} from "@sovereign/protocol";

import { createCredentialStore, credentialsFileName } from "./credential-store.ts";
import { createProviderLogins } from "./provider-logins.ts";
import { ensureDataDirectory } from "./platform/public.ts";
import { createDispatcher } from "./http/public.ts";
import { createEventBus } from "./platform/public.ts";
import { createLogger, type Logger } from "./platform/public.ts";
import { createModelCatalogStore } from "./model-catalog-store.ts";
import { providersRoutes } from "./providers.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-providers-route-"));
const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  rmSync(workspace, { recursive: true, force: true });
});

const quietLogger = (): Logger =>
  createLogger({ source: "core", level: () => "debug", write: () => {} });

type Answer = { status: number; body: unknown };

async function serve(options: { contents?: string; variables?: Record<string, string> } = {}) {
  const directory = ensureDataDirectory(mkdtempSync(join(workspace, "case-")));

  if (options.contents !== undefined) {
    writeFileSync(join(directory, credentialsFileName), options.contents);
  }

  const logger = quietLogger();
  const credentials = createCredentialStore({ directory, logger });
  const catalogs = createModelCatalogStore({ directory, logger });
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const events: BusEvent[] = [];

  bus.subscribe((event) => events.push(event));

  const catalogue = createProviderCatalogue({
    credentials,
    catalogs,
    environment: emptyEnvironment(options.variables),
  });
  const logins = createProviderLogins({ runner: catalogue, logger });
  const server = createServer(
    createDispatcher({
      routes: providersRoutes({ catalogue, credentials, logger, bus, logins }),
      logger,
      authenticate: () => ({ kind: "session" as const, id: "the-session" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (method: string, path: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        // Изменяющий запрос обязан назвать себя json, иначе диспетчер отвечает 415
        // (docs/web-api.md). Тела у обновления нет — обновляется всё, что настроено.
        { host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json" } },
        (incoming) => {
          let text = "";

          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            text += chunk;
          });
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              body: text === "" ? undefined : JSON.parse(text),
            }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end();
    });

  return {
    credentials,
    events,
    list: () => call("GET", providersPath),
    logout: (providerId: string) => call("DELETE", providerCredentialPath(providerId)),
    models: (providerId: string) => call("GET", providerModelsPath(providerId)),
    refresh: () => call("POST", providersRefreshPath),
  };
}

describe("GET /api/providers", () => {
  it("answers with every provider the runtime knows", async () => {
    const { list } = await serve();
    const answer = await list();
    const snapshot = answer.body as ProvidersSnapshot;

    assert.equal(answer.status, 200);
    assert.ok(snapshot.providers.length >= 38);
    assert.equal(snapshot.problem, undefined);

    const anthropic = snapshot.providers.find((provider) => provider.id === "anthropic");

    assert.ok(anthropic);
    assert.deepEqual(anthropic.auth, { kind: "unconfigured" });
    assert.ok(anthropic.modelCount > 0);
    assert.ok(anthropic.logins.length > 0);
  });

  it("says nothing about models in the snapshot: there are more than a thousand", async () => {
    const { list } = await serve();
    const snapshot = (await list()).body as ProvidersSnapshot;

    assert.ok(snapshot.providers.every((provider) => !("models" in provider)));
  });

  it("shows a provider configured by the environment as configured", async () => {
    const { list } = await serve({ variables: { ANTHROPIC_API_KEY: "не-настоящий" } });
    const snapshot = (await list()).body as ProvidersSnapshot;

    assert.deepEqual(snapshot.providers.find((provider) => provider.id === "anthropic")?.auth, {
      kind: "configured",
      type: "api_key",
      source: "ANTHROPIC_API_KEY",
    });
  });

  it("still answers 200 when the credentials file is unreadable", async () => {
    const { list } = await serve({ contents: "{ это не json" });
    const answer = await list();
    const snapshot = answer.body as ProvidersSnapshot;

    // Отличие от проектов намеренное: каталог провайдеров от файла кредов не зависит, а пустое вью
    // не помогает человеку починить файл (docs/web-api.md).
    assert.equal(answer.status, 200);
    assert.match(snapshot.problem ?? "", /credentials\.json/);
    assert.ok(snapshot.providers.length >= 38);
    assert.ok(snapshot.providers.every((provider) => provider.auth.kind === "unknown"));
  });
});

describe("POST /api/providers/refresh", () => {
  it("answers with an outcome per dynamic provider and touches nothing else", async () => {
    const { refresh } = await serve();
    const answer = await refresh();
    const report = answer.body as RefreshReport;

    assert.equal(answer.status, 200);
    assert.equal(report.aborted, false);
    // Динамический список моделей у встроенных провайдеров ровно один (docs/runtime-checks.md,
    // проверка 31), и без креда рантайм его пропускает: сети в тесте нет.
    assert.deepEqual(
      report.refreshed.map((outcome) => outcome.providerId),
      ["radius"],
    );
    assert.equal(report.refreshed[0]?.error, undefined);
  });

  it("tells the open browser that the catalogue changed", async () => {
    const { refresh, events } = await serve();

    await refresh();

    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providersChanged],
    );
  });
});

describe("DELETE /api/providers/:providerId/credential", () => {
  it("removes the credential, tells the bus and answers with the new status", async () => {
    const { logout, credentials, events } = await serve();

    await credentials.modify("anthropic", async () => ({ type: "api_key", key: "s3cret" }));

    const answer = await logout("anthropic");

    assert.equal(answer.status, 200);
    assert.deepEqual((answer.body as ProviderSummary).auth, { kind: "unconfigured" });
    assert.deepEqual(credentials.list(), []);
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providerLogout],
    );
  });

  it("says the provider is still configured when the credential came from the environment", async () => {
    // Ловушка «нажал выход, ничего не изменилось»: кред из окружения не наш, и убрать его нечем.
    const { logout, credentials } = await serve({
      variables: { ANTHROPIC_API_KEY: "не-настоящий" },
    });

    await credentials.modify("anthropic", async () => ({ type: "api_key", key: "s3cret" }));

    const summary = (await logout("anthropic")).body as ProviderSummary;

    assert.deepEqual(credentials.list(), []);
    assert.deepEqual(summary.auth, {
      kind: "configured",
      type: "api_key",
      source: "ANTHROPIC_API_KEY",
    });
  });

  it("refuses to write over a credentials file it could not read", async () => {
    const { logout } = await serve({ contents: "{ это не json" });

    assert.equal((await logout("anthropic")).status, 409);
  });

  it("answers 404 for a provider nobody registered", async () => {
    const { logout } = await serve();

    assert.equal((await logout("выдуманный")).status, 404);
  });
});

describe("GET /api/providers/:providerId/models", () => {
  it("answers with the models of one provider", async () => {
    const { models } = await serve();
    const answer = await models("anthropic");
    const body = answer.body as ProviderModels;

    assert.equal(answer.status, 200);
    assert.equal(body.providerId, "anthropic");
    assert.ok(body.models.length > 0);
    assert.ok(body.models.every((model) => model.providerId === "anthropic"));
  });

  it("answers 404 for a provider nobody registered", async () => {
    const { models } = await serve();

    assert.equal((await models("выдуманный")).status, 404);
  });

  it("answers with the models even when the credentials file is unreadable", async () => {
    // Список моделей от кредов не зависит вовсе: он лежит в пакете рантайма.
    const { models } = await serve({ contents: "{ это не json" });

    assert.equal((await models("anthropic")).status, 200);
  });
});
