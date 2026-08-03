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
      hasActiveSession: () => active,
    }),
  };
}

describe("user provider lifecycle", () => {
  it("persists only after runtime registration and updates the common catalogue", async () => {
    const { providers, catalogue } = service();
    assert.equal(providers.create(definition()).kind, "done");
    assert.equal(
      (await catalogue.snapshot()).providers.find((one) => one.id === "vendor-local")?.origin,
      "user",
    );
    assert.equal(
      providers.replace("vendor-local", { ...definition(), name: "Renamed" }).kind,
      "done",
    );
    assert.equal(
      (await catalogue.snapshot()).providers.find((one) => one.id === "vendor-local")?.name,
      "Renamed",
    );
  });

  it("blocks deletion while a session is active and removes credentials afterward", async () => {
    const blocked = service(true);
    blocked.providers.create(definition());
    assert.equal((await blocked.providers.remove("vendor-local")).kind, "busy");

    const free = service();
    free.providers.create(definition());
    await free.credentials.modify("vendor-local", async () => ({ type: "api_key", key: "secret" }));
    assert.equal((await free.providers.remove("vendor-local")).kind, "removed");
    assert.deepEqual(free.credentials.list(), []);
    assert.equal(free.catalogue.modelsOf("vendor-local"), undefined);
  });
});
