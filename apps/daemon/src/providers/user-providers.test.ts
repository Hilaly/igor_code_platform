import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import { emptyEnvironment } from "@sovereign/agent-runtime-pi/testing";
import type { UserProviderDefinition } from "@sovereign/protocol";

import { ensureDataDirectory, createLogger } from "../platform/public.ts";
import { createCredentialStore } from "./credential-store.ts";
import { createModelCatalogStore } from "./model-catalog-store.ts";
import { createUserProviderStore } from "./user-provider-store.ts";
import { createUserProviders } from "./user-providers.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-user-provider-service-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const logger = () => createLogger({ source: "core", level: () => "debug", write: () => undefined });
const definition = (): UserProviderDefinition => ({
  id: "vendor-local",
  name: "Vendor Local",
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
  manualModels: [{ id: "one", name: "One", contextWindow: 32_000, maxTokens: 4_096 }],
  modelOverrides: {},
  disabledModelIds: [],
});

function service(active = false) {
  const directory = ensureDataDirectory(mkdtempSync(join(workspace, "case-")));
  const oneLogger = logger();
  const credentials = createCredentialStore({ directory, logger: oneLogger });
  const catalogs = createModelCatalogStore({ directory, logger: oneLogger });
  const catalogue = createProviderCatalogue({
    credentials,
    catalogs,
    environment: emptyEnvironment(),
  });
  return {
    credentials,
    catalogue,
    providers: createUserProviders({
      store: createUserProviderStore({ directory, logger: oneLogger }),
      catalogue,
      credentials,
      catalogs,
      logins: { runningFor: () => undefined, cancel: () => false },
      hasActiveSession: () => active,
    }),
  };
}

const cachedModel = {
  id: "remote",
  name: "Remote",
  api: "openai-responses" as const,
  provider: "vendor-local",
  baseUrl: "http://127.0.0.1:11434/v1",
  reasoning: false,
  input: ["text"] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

describe("user provider lifecycle", () => {
  it("persists only after runtime registration and updates the common catalogue", async () => {
    const { providers, catalogue } = service();
    assert.equal((await providers.create(definition())).kind, "done");
    assert.equal(
      (await catalogue.snapshot()).providers.find((one) => one.id === "vendor-local")?.origin,
      "user",
    );
    assert.equal(
      (await providers.replace("vendor-local", { ...definition(), name: "Renamed" })).kind,
      "done",
    );
    assert.equal(
      (await catalogue.snapshot()).providers.find((one) => one.id === "vendor-local")?.name,
      "Renamed",
    );
  });

  it("blocks deletion while a session is active and removes credentials afterward", async () => {
    const blocked = service(true);
    await blocked.providers.create(definition());
    assert.equal((await blocked.providers.remove("vendor-local")).kind, "busy");

    const free = service();
    await free.providers.create(definition());
    await free.credentials.modify("vendor-local", async () => ({ type: "api_key", key: "secret" }));
    assert.equal((await free.providers.remove("vendor-local")).kind, "removed");
    assert.deepEqual(free.credentials.list(), []);
    assert.equal(free.catalogue.modelsOf("vendor-local"), undefined);
  });

  it("restores cached models at startup and reapplies edited overrides", async () => {
    const directory = ensureDataDirectory(mkdtempSync(join(workspace, "cache-")));
    const oneLogger = logger();
    const credentials = createCredentialStore({ directory, logger: oneLogger });
    const catalogs = createModelCatalogStore({ directory, logger: oneLogger });
    const store = createUserProviderStore({ directory, logger: oneLogger });
    assert.equal(
      store.create({ ...definition(), modelsEndpoint: { kind: "default" } }).kind,
      "created",
    );
    catalogs.write("vendor-local", { models: [cachedModel] });
    const catalogue = createProviderCatalogue({
      credentials,
      catalogs,
      environment: emptyEnvironment(),
    });
    const providers = createUserProviders({
      store,
      catalogue,
      credentials,
      catalogs,
      logins: { runningFor: () => undefined, cancel: () => false },
      hasActiveSession: () => false,
    });
    await providers.ready();
    assert.equal(
      catalogue.modelsOf("vendor-local")?.find((model) => model.id === "remote")?.contextWindow,
      128_000,
    );
    await providers.replace("vendor-local", {
      ...definition(),
      modelsEndpoint: { kind: "default" },
      modelOverrides: { remote: { contextWindow: 256_000 } },
    });
    assert.equal(
      catalogue.modelsOf("vendor-local")?.find((model) => model.id === "remote")?.contextWindow,
      256_000,
    );
  });

  it("cancels login and keeps the definition when credential cleanup refuses", async () => {
    const base = service();
    let cancelled = false;
    const directory = ensureDataDirectory(mkdtempSync(join(workspace, "rollback-")));
    const oneLogger = logger();
    const store = createUserProviderStore({ directory, logger: oneLogger });
    const catalogs = createModelCatalogStore({ directory, logger: oneLogger });
    const catalogue = createProviderCatalogue({
      credentials: base.credentials,
      catalogs,
      environment: emptyEnvironment(),
    });
    const providers = createUserProviders({
      store,
      catalogue,
      credentials: {
        ...base.credentials,
        remove: async () => {
          throw new Error("credentials unavailable");
        },
      },
      catalogs,
      logins: {
        runningFor: () => ({ attemptId: "login", providerId: "vendor-local" }) as never,
        cancel: () => {
          cancelled = true;
          return true;
        },
      },
      hasActiveSession: () => false,
    });
    await providers.create(definition());
    assert.equal((await providers.remove("vendor-local")).kind, "refused");
    assert.equal(cancelled, true);
    assert.equal(providers.find("vendor-local")?.definition.id, "vendor-local");
    assert.equal(catalogue.customProviderOrigin("vendor-local"), "user");
  });

  it("lets lifecycle mutations of another provider pass a slow refresh", async () => {
    const one = service();
    await one.providers.create({ ...definition(), modelsEndpoint: { kind: "default" } });
    let release!: () => void;
    const original = one.catalogue.refreshProvider;
    one.catalogue.refreshProvider = async (providerId, signal, origin) => {
      await new Promise<void>((resolve) => (release = resolve));
      return original(providerId, signal, origin);
    };
    const refreshing = one.providers.refresh("vendor-local");
    await Promise.resolve();
    const second = { ...definition(), id: "second", name: "Second" };
    const created = await one.providers.create(second);
    assert.equal(created.kind, "done");
    release();
    await refreshing;
  });
});
