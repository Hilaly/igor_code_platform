import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { UserProviderDefinition } from "@sovereign/protocol";

import { createLogger, ensureDataDirectory } from "../platform/public.ts";
import { createUserProviderStore, userProvidersFileName } from "./user-provider-store.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-user-providers-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

let serial = 0;
const logger = () => createLogger({ source: "core", level: () => "debug", write: () => undefined });

function definition(id = "vendor-local"): UserProviderDefinition {
  return {
    id,
    name: "Vendor Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-responses",
    modelsEndpoint: { kind: "default" },
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
  };
}

function directory(): string {
  serial += 1;
  return ensureDataDirectory(join(workspace, `data-${serial}`));
}

describe("the user provider store", () => {
  it("keeps definitions across restart and writes owner-only", () => {
    const data = directory();
    const one = createUserProviderStore({ directory: data, logger: logger() });

    assert.deepEqual(one.create(definition()), { kind: "created", definition: definition() });
    assert.deepEqual(createUserProviderStore({ directory: data, logger: logger() }).list(), [
      definition(),
    ]);
    assert.equal(statSync(join(data, userProvidersFileName)).mode & 0o777, 0o600);
  });

  it("refuses duplicate creation and supports replacement and removal", () => {
    const one = createUserProviderStore({ directory: directory(), logger: logger() });
    one.create(definition());

    assert.equal(one.create(definition()).kind, "taken");
    assert.deepEqual(one.replace("vendor-local", { ...definition(), name: "Renamed" }), {
      kind: "replaced",
      definition: { ...definition(), name: "Renamed" },
    });
    assert.equal(one.replace("vendor-local", definition("other")).kind, "identifier_changed");
    assert.deepEqual(one.remove("vendor-local"), { kind: "removed" });
    assert.deepEqual(one.list(), []);
    assert.deepEqual(one.remove("vendor-local"), { kind: "unknown" });
  });

  it("refuses to overwrite an unreadable registry", () => {
    const data = directory();
    const path = join(data, userProvidersFileName);
    writeFileSync(path, "not json");
    const one = createUserProviderStore({ directory: data, logger: logger() });

    assert.equal(one.create(definition()).kind, "refused");
    assert.equal(readFileSync(path, "utf8"), "not json");
  });
});
