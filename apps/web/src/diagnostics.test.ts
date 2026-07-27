import { describe, expect, it } from "vitest";

import { createDiagnosticsStore, type Diagnostic } from "./diagnostics.ts";

describe("createDiagnosticsStore", () => {
  it("keeps the newest first and wakes the subscriber", () => {
    const store = createDiagnosticsStore();
    const seen: Diagnostic[][] = [];

    store.subscribe((list) => seen.push(list));
    store.record("the stream broke off");
    store.record("no translation for state.loading");

    expect(store.list().map((entry) => entry.text)).toEqual([
      "no translation for state.loading",
      "the stream broke off",
    ]);
    expect(seen).toHaveLength(2);
  });

  it("keeps two identical messages apart", () => {
    const store = createDiagnosticsStore();

    store.record("the stream broke off");
    store.record("the stream broke off");

    expect(new Set(store.list().map((entry) => entry.index)).size).toBe(2);
  });

  it("does not grow without a limit: the source is a plugin, and it may be broken", () => {
    const store = createDiagnosticsStore();

    for (let round = 0; round < 500; round += 1) {
      store.record(`round ${round}`);
    }

    expect(store.list()).toHaveLength(200);
    expect(store.list()[0]?.text).toBe("round 499");
  });

  it("stops telling whoever unsubscribed", () => {
    const store = createDiagnosticsStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.record("first");
    unsubscribe();
    store.record("second");

    expect(calls).toBe(1);
  });
});
