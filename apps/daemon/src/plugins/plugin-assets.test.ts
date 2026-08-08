import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPluginAssetStore, retainedRevisionCount } from "./plugin-assets.ts";
import type { PluginBrowserBundle } from "./plugin-browser-build.ts";

function bundle(revision: string, script = `// ${revision}`): PluginBrowserBundle {
  return {
    revision,
    files: new Map([["browser.js", new TextEncoder().encode(script)]]),
  };
}

function scriptOf(contents: Uint8Array | undefined): string | undefined {
  return contents === undefined ? undefined : Buffer.from(contents).toString("utf8");
}

describe("createPluginAssetStore", () => {
  it("gives back the file of the revision that was asked for", () => {
    const store = createPluginAssetStore();
    store.put("data:hello", bundle("r1", "first"));

    assert.equal(scriptOf(store.read("data:hello", "r1", "browser.js")), "first");
    assert.equal(store.read("data:hello", "r1", "browser.css"), undefined);
    assert.equal(store.read("data:hello", "r2", "browser.js"), undefined);
    assert.equal(store.read("data:other", "r1", "browser.js"), undefined);
  });

  it("keeps the previous revision alongside the current one", () => {
    const store = createPluginAssetStore();
    store.put("data:hello", bundle("r1", "first"));
    store.put("data:hello", bundle("r2", "second"));

    assert.deepEqual(store.revisions("data:hello"), ["r2", "r1"]);
    assert.equal(scriptOf(store.read("data:hello", "r1", "browser.js")), "first");
  });

  /**
   * Старый ES-модуль из кеша браузера выгрузить нельзя, поэтому ревизии копятся — но не бесконечно:
   * между двумя перезагрузками плагина страница либо обновилась, либо ей всё равно пора.
   */
  it("drops the oldest revision beyond the retained count", () => {
    const store = createPluginAssetStore();
    store.put("data:hello", bundle("r1"));
    store.put("data:hello", bundle("r2"));
    store.put("data:hello", bundle("r3"));

    assert.equal(store.revisions("data:hello").length, retainedRevisionCount);
    assert.deepEqual(store.revisions("data:hello"), ["r3", "r2"]);
    assert.equal(store.read("data:hello", "r1", "browser.js"), undefined);
  });

  /** Пересборка без правок даёт ту же ревизию: она обязана остаться одной записью, а не двумя. */
  it("does not count the same revision twice", () => {
    const store = createPluginAssetStore();
    store.put("data:hello", bundle("r1"));
    store.put("data:hello", bundle("r2"));
    store.put("data:hello", bundle("r1"));

    assert.deepEqual(store.revisions("data:hello"), ["r1", "r2"]);
  });

  it("forgets a plugin whole, and only that plugin", () => {
    const store = createPluginAssetStore();
    store.put("data:hello", bundle("r1"));
    store.put("data:hello", bundle("r2"));
    store.put("data:other", bundle("r1"));

    store.forget("data:hello");

    assert.deepEqual(store.revisions("data:hello"), []);
    assert.equal(store.read("data:hello", "r2", "browser.js"), undefined);
    assert.notEqual(store.read("data:other", "r1", "browser.js"), undefined);
  });
});
