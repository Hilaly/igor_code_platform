import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import { emptyEnvironment } from "@sovereign/agent-runtime-pi/testing";
import {
  userProviderPath,
  userProviderRefreshPath,
  userProvidersPath,
  type UserProviderDefinition,
  type UserProviderDetails,
  type UserProvidersSnapshot,
} from "@sovereign/protocol";

import { createDispatcher } from "../http/public.ts";
import { createEventBus, createLogger, ensureDataDirectory } from "../platform/public.ts";
import { createCredentialStore } from "./credential-store.ts";
import { createModelCatalogStore } from "./model-catalog-store.ts";
import { userProviderRoutes } from "./user-provider-routes.ts";
import { createUserProviderStore } from "./user-provider-store.ts";
import { createUserProviders } from "./user-providers.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-user-provider-routes-"));
const servers: Server[] = [];
after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  rmSync(workspace, { recursive: true, force: true });
});

const definition = (): UserProviderDefinition => ({
  id: "vendor",
  name: "Vendor",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-responses",
  modelsEndpoint: { kind: "disabled" },
  modelDefaults: {
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
  },
  manualModels: [],
  modelOverrides: {},
  disabledModelIds: [],
});

async function serve() {
  const directory = ensureDataDirectory(mkdtempSync(join(workspace, "case-")));
  const logger = createLogger({ source: "core", level: () => "debug", write: () => undefined });
  const credentials = createCredentialStore({ directory, logger });
  const catalogs = createModelCatalogStore({ directory, logger });
  const catalogue = createProviderCatalogue({
    credentials,
    catalogs,
    environment: emptyEnvironment(),
  });
  const bus = createEventBus({ onListenerError: () => undefined });
  const providers = createUserProviders({
    store: createUserProviderStore({ directory, logger }),
    catalogue,
    credentials,
    catalogs,
    logins: { runningFor: () => undefined, cancel: () => false },
    hasActiveSession: () => false,
  });
  const server = createServer(
    createDispatcher({
      routes: userProviderRoutes({ providers, bus, logger }),
      logger,
      authenticate: () => ({ kind: "session", id: "one" }),
    }),
  );
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  return (
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
            resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }),
          );
        },
      );
      request.on("error", reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

describe("the user provider HTTP API", () => {
  it("creates, reads, updates, refreshes, and deletes one definition", async () => {
    const call = await serve();
    assert.equal((await call("POST", userProvidersPath, definition())).status, 200);
    const listed = (await call("GET", userProvidersPath)).body as UserProvidersSnapshot;
    const found = (await call("GET", userProviderPath("vendor"))).body as UserProviderDetails;
    assert.equal(listed.providers.length, 1);
    assert.equal(found.definition.id, "vendor");
    const updated = (
      await call("PUT", userProviderPath("vendor"), { ...definition(), name: "Renamed" })
    ).body as UserProviderDetails;
    assert.equal(updated.definition.name, "Renamed");
    assert.equal((await call("POST", userProviderRefreshPath("vendor"))).status, 200);
    assert.deepEqual((await call("DELETE", userProviderPath("vendor"))).body, { id: "vendor" });
    assert.equal((await call("GET", userProviderPath("vendor"))).status, 404);
  });

  it("refuses malformed definitions", async () => {
    const call = await serve();
    assert.equal(
      (await call("POST", userProvidersPath, { ...definition(), id: "Bad ID" })).status,
      400,
    );
  });

  it("returns the store problem in the collection snapshot", async () => {
    const directory = ensureDataDirectory(mkdtempSync(join(workspace, "broken-")));
    const logger = createLogger({ source: "core", level: () => "debug", write: () => undefined });
    const credentials = createCredentialStore({ directory, logger });
    const catalogs = createModelCatalogStore({ directory, logger });
    const catalogue = createProviderCatalogue({
      credentials,
      catalogs,
      environment: emptyEnvironment(),
    });
    const providers = createUserProviders({
      store: {
        list: () => [],
        find: () => undefined,
        create: () => ({ kind: "refused", reason: "broken" }),
        replace: () => ({ kind: "refused", reason: "broken" }),
        remove: () => ({ kind: "refused", reason: "broken" }),
        problem: () => "user-providers.json is not valid json",
        subscribe: () => () => undefined,
      },
      catalogue,
      credentials,
      catalogs,
      logins: { runningFor: () => undefined, cancel: () => false },
      hasActiveSession: () => false,
    });
    assert.equal(providers.problem(), "user-providers.json is not valid json");
  });
});
