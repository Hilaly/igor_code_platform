import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toRuntimeCredentialStore } from "./credentials.ts";
import { inMemoryVault } from "./testing.ts";

describe("toRuntimeCredentialStore", () => {
  it("passes a stored credential to the runtime as it lies", async () => {
    const vault = inMemoryVault({ anthropic: { type: "api_key", key: "s3cret" } });
    const store = toRuntimeCredentialStore(vault);

    assert.deepEqual(await store.read("anthropic"), { type: "api_key", key: "s3cret" });
    assert.equal(await store.read("openai"), undefined);
  });

  it("lists what is stored without exposing values", async () => {
    const vault = inMemoryVault({
      anthropic: { type: "api_key", key: "s3cret" },
      openai: { type: "oauth", access: "a", refresh: "r", expires: 1 },
    });

    assert.deepEqual(await toRuntimeCredentialStore(vault).list(), [
      { providerId: "anthropic", type: "api_key" },
      { providerId: "openai", type: "oauth" },
    ]);
  });

  it("writes through the vault, current credential first", async () => {
    const vault = inMemoryVault({ anthropic: { type: "api_key", key: "old" } });
    const store = toRuntimeCredentialStore(vault);
    const seen: unknown[] = [];

    const written = await store.modify("anthropic", async (current) => {
      seen.push(current);

      return { type: "api_key", key: "new" };
    });

    assert.deepEqual(seen, [{ type: "api_key", key: "old" }]);
    assert.deepEqual(written, { type: "api_key", key: "new" });
    assert.deepEqual(await vault.read("anthropic"), { type: "api_key", key: "new" });
  });

  it("removes through the vault", async () => {
    const vault = inMemoryVault({ anthropic: { type: "api_key", key: "s3cret" } });

    await toRuntimeCredentialStore(vault).delete("anthropic");

    assert.equal(await vault.read("anthropic"), undefined);
  });

  it("refuses a stored credential of an unknown kind instead of ignoring it", async () => {
    // Файл правится руками, и запись с чужим `type` — не «нет креда», а «кред есть, но непонятный».
    // Молчаливое `undefined` выглядело бы для человека как внезапный разлогин.
    const vault = inMemoryVault({ anthropic: { type: "магия", key: "s3cret" } });
    const store = toRuntimeCredentialStore(vault);

    await assert.rejects(store.read("anthropic"), /anthropic/);
    await assert.rejects(store.list(), /anthropic/);
  });
});
