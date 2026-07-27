import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CustomContribution } from "@sovereign/sdk";

import { createContributionRegistry, type ContributingPlugin } from "./contribution-registry.ts";

const builtinHello: ContributingPlugin = { key: "builtin:hello", id: "hello", source: "builtin" };
const dataHello: ContributingPlugin = { key: "data:hello", id: "hello", source: "data" };
const dataNotes: ContributingPlugin = { key: "data:notes", id: "notes", source: "data" };

const board: CustomContribution = { id: "board", title: "Board" };

const nothingDisabled = new Set<string>();

describe("createContributionRegistry", () => {
  it("gives the identifier the plugin namespace", () => {
    const registry = createContributionRegistry();

    const outcome = registry.apply(dataHello, [board], nothingDisabled);

    assert.deepEqual(
      outcome.registered.map((registration) => registration.id),
      ["hello.board"],
    );
    assert.deepEqual(
      registry.resolved().map((registration) => registration.id),
      ["hello.board"],
    );
  });

  it("refuses an identifier that cannot be namespaced", () => {
    const registry = createContributionRegistry();

    const outcome = registry.apply(dataHello, [{ id: "Board Panel" }], nothingDisabled);

    assert.equal(outcome.registered.length, 0);
    assert.equal(outcome.problems.length, 1);
    assert.deepEqual(registry.resolved(), []);
  });

  it("applies neither copy when one plugin declares an identifier twice", () => {
    const registry = createContributionRegistry();

    const outcome = registry.apply(
      dataHello,
      [board, { id: "board", title: "Another board" }],
      nothingDisabled,
    );

    assert.deepEqual(outcome.registered, []);
    assert.match(outcome.problems[0] ?? "", /declared 2 times/);
  });

  it("applies neither contribution when two plugins of one source claim it", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board], nothingDisabled);
    registry.apply({ ...dataNotes, id: "hello" }, [board], nothingDisabled);

    assert.deepEqual(registry.resolved(), []);
    assert.deepEqual(registry.conflicts(), [
      { id: "hello.board", source: "data", plugins: ["data:hello", "data:notes"] },
    ]);
  });

  it("lets the more specific source win over the built-in one", () => {
    const registry = createContributionRegistry();

    registry.apply(builtinHello, [{ id: "board", title: "Built-in board" }], nothingDisabled);
    registry.apply(dataHello, [{ id: "board", title: "Overriding board" }], nothingDisabled);

    assert.deepEqual(
      registry.resolved().map((registration) => [registration.source, registration.title]),
      [["data", "Overriding board"]],
    );
    assert.deepEqual(registry.conflicts(), []);
  });

  it("keeps a disabled contribution out of the resolution entirely", () => {
    const registry = createContributionRegistry();

    registry.apply(builtinHello, [{ id: "board", title: "Built-in board" }], nothingDisabled);
    registry.apply(dataHello, [board], new Set(["hello.board"]));

    // Выключенный вклад не перекрывает встроенный: он не участвует ни в чём (ADR-0032).
    assert.deepEqual(
      registry.resolved().map((registration) => [registration.source, registration.title]),
      [["builtin", "Built-in board"]],
    );
  });

  it("replaces the whole set of a plugin at once", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board, { id: "panel" }], nothingDisabled);
    registry.apply(dataHello, [{ id: "panel" }], nothingDisabled);

    assert.deepEqual(
      registry.resolved().map((registration) => registration.id),
      ["hello.panel"],
    );
  });

  it("removes everything a plugin registered when it goes away", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board, { id: "panel" }], nothingDisabled);
    registry.remove("data:hello");

    assert.deepEqual(registry.resolved(), []);
  });

  it("moves the revision only when the resolved set changed", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board], nothingDisabled);
    const afterFirst = registry.revision();

    registry.apply(dataHello, [board], nothingDisabled);

    assert.equal(registry.revision(), afterFirst);

    registry.apply(dataHello, [board, { id: "panel" }], nothingDisabled);

    assert.equal(registry.revision(), afterFirst + 1);
  });

  it("brings the overridden contribution back when the overriding plugin leaves", () => {
    const registry = createContributionRegistry();

    registry.apply(builtinHello, [{ id: "board", title: "Built-in board" }], nothingDisabled);
    registry.apply(dataHello, [{ id: "board", title: "Overriding board" }], nothingDisabled);
    registry.remove("data:hello");

    assert.deepEqual(
      registry.resolved().map((registration) => registration.title),
      ["Built-in board"],
    );
  });
});
