import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planRoute, sameAttempt, type Attempt } from "./route.ts";

const anthropic = { providerId: "anthropic", modelId: "claude-opus-4-5" };
const openai = { providerId: "openai", modelId: "gpt-5" };

const keysOf =
  (keys: Record<string, string[]>) =>
  (providerId: string): string[] =>
    keys[providerId] ?? [];

describe("planRoute", () => {
  it("walks the keys of one candidate in the order they came", () => {
    const route = planRoute({
      candidates: [anthropic],
      keysOf: keysOf({ anthropic: ["key-2", "key-1"] }),
    });

    assert.deepEqual(route, [
      { candidate: anthropic, keyId: "key-2" },
      { candidate: anthropic, keyId: "key-1" },
    ]);
  });

  it("walks the candidates in the order the human named them", () => {
    const route = planRoute({
      candidates: [anthropic, openai],
      keysOf: keysOf({ anthropic: ["key-1"], openai: ["key-1", "key-2"] }),
    });

    assert.deepEqual(
      route.map((attempt) => `${attempt.candidate.providerId}/${attempt.keyId ?? ""}`),
      ["anthropic/key-1", "openai/key-1", "openai/key-2"],
    );
  });

  it("gives a provider without stored keys one attempt with no key", () => {
    // Кред из окружения — такой же законный способ ходить, как ключ из набора.
    const route = planRoute({ candidates: [anthropic], keysOf: keysOf({}) });

    assert.deepEqual(route, [{ candidate: anthropic, keyId: undefined }]);
  });

  it("starts from what the session already holds", () => {
    const sticky: Attempt = { candidate: anthropic, keyId: "key-2" };
    const route = planRoute({
      candidates: [anthropic],
      keysOf: keysOf({ anthropic: ["key-1", "key-2"] }),
      sticky,
    });

    // Липкость: сессия ходит одним ключом, пока он не откажет.
    assert.deepEqual(route[0], sticky);
    assert.deepEqual(route, [sticky, { candidate: anthropic, keyId: "key-1" }]);
  });

  it("does not repeat the sticky attempt further down the list", () => {
    const route = planRoute({
      candidates: [anthropic],
      keysOf: keysOf({ anthropic: ["key-1", "key-2"] }),
      sticky: { candidate: anthropic, keyId: "key-1" },
    });

    assert.equal(route.length, 2);
  });

  it("drops a sticky key that is gone from the set", () => {
    const route = planRoute({
      candidates: [anthropic],
      keysOf: keysOf({ anthropic: ["key-2"] }),
      sticky: { candidate: anthropic, keyId: "key-1" },
    });

    // Ключ убрали, пока сессия им ходила: держаться за него нечем.
    assert.deepEqual(route, [{ candidate: anthropic, keyId: "key-2" }]);
  });

  it("drops a sticky candidate that is no longer named", () => {
    const route = planRoute({
      candidates: [openai],
      keysOf: keysOf({ openai: ["key-1"] }),
      sticky: { candidate: anthropic, keyId: "key-1" },
    });

    assert.deepEqual(route, [{ candidate: openai, keyId: "key-1" }]);
  });

  it("is empty when there is nothing to try at all", () => {
    assert.deepEqual(planRoute({ candidates: [], keysOf: keysOf({}) }), []);
  });
});

describe("sameAttempt", () => {
  it("compares by value: attempts are built anew on every request", () => {
    assert.ok(
      sameAttempt(
        { candidate: anthropic, keyId: "key-1" },
        { candidate: { ...anthropic }, keyId: "key-1" },
      ),
    );
    assert.ok(
      !sameAttempt(
        { candidate: anthropic, keyId: "key-1" },
        { candidate: anthropic, keyId: "key-2" },
      ),
    );
    assert.ok(!sameAttempt({ candidate: anthropic, keyId: undefined }, undefined));
    assert.ok(sameAttempt(undefined, undefined));
  });
});
