import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CustomContribution, PluginContribution } from "@sovereign/sdk";

import { createContributionRegistry, type ContributingPlugin } from "./contribution-registry.ts";

const builtinHello: ContributingPlugin = { key: "builtin:hello", id: "hello", source: "builtin" };
const dataHello: ContributingPlugin = { key: "data:hello", id: "hello", source: "data" };
const dataNotes: ContributingPlugin = { key: "data:notes", id: "notes", source: "data" };
const projectHello: ContributingPlugin = {
  key: "project:b7Kq3xv9pQdT:hello",
  id: "hello",
  source: "project:b7Kq3xv9pQdT",
};

/** Вид проставляет SDK, а не автор: в реестр вклад приходит уже с ним. */
const custom = (contribution: CustomContribution): PluginContribution => ({
  kind: "custom",
  ...contribution,
});

const board = custom({ id: "board", title: "Board" });

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

    const outcome = registry.apply(dataHello, [custom({ id: "Board Panel" })], nothingDisabled);

    assert.equal(outcome.registered.length, 0);
    assert.equal(outcome.problems.length, 1);
    assert.deepEqual(registry.resolved(), []);
  });

  it("applies neither copy when one plugin declares an identifier twice", () => {
    const registry = createContributionRegistry();

    const outcome = registry.apply(
      dataHello,
      [board, custom({ id: "board", title: "Another board" })],
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

    registry.apply(
      builtinHello,
      [custom({ id: "board", title: "Built-in board" })],
      nothingDisabled,
    );
    registry.apply(
      dataHello,
      [custom({ id: "board", title: "Overriding board" })],
      nothingDisabled,
    );

    assert.deepEqual(
      registry.resolved().map((registration) => [registration.source, registration.title]),
      [["data", "Overriding board"]],
    );
    assert.deepEqual(registry.conflicts(), []);
  });

  it("lets a project folder win over both", () => {
    // Ранг источника проекта нельзя считать позицией в массиве: у параметризованного источника
    // позиции нет, `indexOf` дал бы −1, и папка проекта проиграла бы встроенному.
    const registry = createContributionRegistry();

    registry.apply(builtinHello, [custom({ id: "board", title: "Built-in" })], nothingDisabled);
    registry.apply(dataHello, [custom({ id: "board", title: "Data" })], nothingDisabled);
    registry.apply(projectHello, [custom({ id: "board", title: "Project" })], nothingDisabled);

    assert.deepEqual(
      registry.resolved().map((registration) => [registration.source, registration.title]),
      [["project:b7Kq3xv9pQdT", "Project"]],
    );
    assert.deepEqual(registry.conflicts(), []);
  });

  it("keeps a disabled contribution out of the resolution entirely", () => {
    const registry = createContributionRegistry();

    registry.apply(
      builtinHello,
      [custom({ id: "board", title: "Built-in board" })],
      nothingDisabled,
    );
    registry.apply(dataHello, [board], new Set(["hello.board"]));

    // Выключенный вклад не перекрывает встроенный: он не участвует ни в чём (docs/plugins.md).
    assert.deepEqual(
      registry.resolved().map((registration) => [registration.source, registration.title]),
      [["builtin", "Built-in board"]],
    );
  });

  it("remembers a switched off contribution with its title and kind", () => {
    const registry = createContributionRegistry();

    registry.apply(
      dataHello,
      [board, { kind: "event", id: "task.created", payloadSchema: {} }],
      new Set(["hello.board"]),
    );

    // Интерфейсу нужен не идентификатор, а сам вклад: иначе переключатель нечем подписать.
    assert.deepEqual(
      registry.switchedOff().map((registration) => [registration.id, registration.title]),
      [["hello.board", "Board"]],
    );
    assert.deepEqual(
      registry.resolved().map((registration) => registration.id),
      ["hello.task.created"],
    );
  });

  it("returns a switched on contribution to the resolved set", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board], new Set(["hello.board"]));
    registry.apply(dataHello, [board], nothingDisabled);

    assert.deepEqual(registry.switchedOff(), []);
    assert.deepEqual(
      registry.resolved().map((registration) => registration.id),
      ["hello.board"],
    );
  });

  it("forgets both the resolved and the switched off contributions of a plugin that went away", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board, custom({ id: "panel" })], new Set(["hello.panel"]));
    registry.remove("data:hello");

    assert.deepEqual(registry.resolved(), []);
    assert.deepEqual(registry.switchedOff(), []);
  });

  it("does not remember a contribution the registry refused as switched off", () => {
    const registry = createContributionRegistry();

    // Кривой вклад не «выключен», а не принят: включать его обратно нечем, пока плагин не исправлен.
    registry.apply(dataHello, [custom({ id: "Board Panel" })], new Set(["hello.Board Panel"]));

    assert.deepEqual(registry.switchedOff(), []);
  });

  it("replaces the whole set of a plugin at once", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board, custom({ id: "panel" })], nothingDisabled);
    registry.apply(dataHello, [custom({ id: "panel" })], nothingDisabled);

    assert.deepEqual(
      registry.resolved().map((registration) => registration.id),
      ["hello.panel"],
    );
  });

  it("removes everything a plugin registered when it goes away", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board, custom({ id: "panel" })], nothingDisabled);
    registry.remove("data:hello");

    assert.deepEqual(registry.resolved(), []);
  });

  it("moves the revision only when the resolved set changed", () => {
    const registry = createContributionRegistry();

    registry.apply(dataHello, [board], nothingDisabled);
    const afterFirst = registry.revision();

    registry.apply(dataHello, [board], nothingDisabled);

    assert.equal(registry.revision(), afterFirst);

    registry.apply(dataHello, [board, custom({ id: "panel" })], nothingDisabled);

    assert.equal(registry.revision(), afterFirst + 1);
  });

  it("registers an event with its schema alongside the general kind", () => {
    const registry = createContributionRegistry();
    const payloadSchema = { type: "object", properties: { id: { type: "string" } } };

    const outcome = registry.apply(
      dataHello,
      [board, { kind: "event", id: "task.created", payloadSchema }],
      nothingDisabled,
    );

    assert.deepEqual(
      outcome.registered.map((registration) => [registration.kind, registration.id]),
      [
        ["custom", "hello.board"],
        ["event", "hello.task.created"],
      ],
    );
    assert.deepEqual(
      registry.resolved().find((registration) => registration.kind === "event")?.payloadSchema,
      payloadSchema,
    );
  });

  it("registers an agent with its instructions and tool selection", () => {
    const registry = createContributionRegistry();

    const outcome = registry.apply(
      dataHello,
      [
        {
          kind: "agent",
          id: "agent",
          instructions: "делай, что просят",
          tools: { include: ["*"], exclude: ["bash"] },
          model: "anthropic/claude",
          thinkingLevel: "high",
        },
      ],
      nothingDisabled,
    );

    assert.deepEqual(outcome.problems, []);
    assert.deepEqual(outcome.registered, [
      {
        kind: "agent",
        ownership: "plugin",
        id: "hello.agent",
        declaredId: "agent",
        pluginKey: "data:hello",
        pluginId: "hello",
        source: "data",
        instructions: "делай, что просят",
        tools: { include: ["*"], exclude: ["bash"] },
        model: "anthropic/claude",
        thinkingLevel: "high",
        skills: { include: [], exclude: [] },
      },
    ]);
  });

  it("refuses an agent whose declaration cannot be applied", () => {
    const registry = createContributionRegistry();
    const base = { kind: "agent", id: "agent", instructions: "делай" } as const;

    for (const broken of [
      { ...base, instructions: "   ", tools: { include: ["*"] } },
      { ...base, tools: "invalid" },
      { ...base, tools: { include: "*" } },
      { ...base, tools: { include: ["*"], exclude: [7] } },
      { ...base, tools: { include: ["*"] }, thinkingLevel: "выше крыши" },
      { ...base, tools: { include: ["*"] }, skills: "one" },
    ]) {
      const outcome = registry.apply(
        dataHello,
        [broken as unknown as PluginContribution],
        nothingDisabled,
      );

      assert.deepEqual(outcome.registered, [], JSON.stringify(broken));
      assert.equal(outcome.problems.length, 1, JSON.stringify(broken));
    }
  });

  it("lets an agent of a more specific source override the built-in one", () => {
    const registry = createContributionRegistry();
    const agent = (instructions: string): PluginContribution => ({
      kind: "agent",
      id: "agent",
      instructions,
      tools: { include: ["*"] },
    });

    registry.apply(builtinHello, [agent("встроенные инструкции")], nothingDisabled);
    registry.apply(dataHello, [agent("свои инструкции")], nothingDisabled);

    const resolved = registry.resolved().filter((registration) => registration.kind === "agent");

    assert.deepEqual(
      resolved.map((registration) => [registration.source, registration.instructions]),
      [["data", "свои инструкции"]],
    );
  });

  it("refuses an event in the namespace of the core", () => {
    const registry = createContributionRegistry();
    const asCore: ContributingPlugin = { key: "data:core", id: "core", source: "data" };

    const outcome = registry.apply(
      asCore,
      [{ kind: "event", id: "log", payloadSchema: {} }],
      nothingDisabled,
    );

    assert.deepEqual(outcome.registered, []);
    assert.match(outcome.problems[0] ?? "", /namespace of the core/);
  });

  it("keeps a disabled event out, so publishing it has nothing to stand on", () => {
    const registry = createContributionRegistry();

    registry.apply(
      dataHello,
      [{ kind: "event", id: "task.created", payloadSchema: {} }],
      new Set(["hello.task.created"]),
    );

    assert.deepEqual(registry.resolved(), []);
  });

  it("brings the overridden contribution back when the overriding plugin leaves", () => {
    const registry = createContributionRegistry();

    registry.apply(
      builtinHello,
      [custom({ id: "board", title: "Built-in board" })],
      nothingDisabled,
    );
    registry.apply(
      dataHello,
      [custom({ id: "board", title: "Overriding board" })],
      nothingDisabled,
    );
    registry.remove("data:hello");

    assert.deepEqual(
      registry.resolved().map((registration) => registration.title),
      ["Built-in board"],
    );
  });
});
