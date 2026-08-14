import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { readRecord, writeRecord } from "./registry.ts";
import { agentMessage, installWorld, session, type World } from "./world.test-helper.ts";

let world: World | undefined;

afterEach(() => {
  world?.restore();
  world = undefined;
});

/** Когда субагент ответил: позже начала своего задания, иначе ответ относится к прошлому. */
const answered = "2026-08-14T09:30:00.000Z";

describe("the subagents plugin", () => {
  it("brings the tools, the routes, the panel and the catalogs of the panel", async () => {
    world = installWorld();

    // Порядок обязателен: сначала шов, потом импорт воркера (docs/plugins.md).
    const { activate } = await import("./worker.ts");

    await activate?.();

    const declared = world.host.contributions.map((contribution) => [
      contribution.kind,
      contribution.id,
    ]);

    assert.deepEqual(
      declared.filter(([kind]) => kind === "tool").map(([, id]) => id),
      [
        "subagent-spawn",
        "subagent-types",
        "subagent-list",
        "subagent-output",
        "subagent-message",
        "subagent-stop",
      ],
    );
    assert.deepEqual(
      declared.filter(([kind]) => kind === "route").map(([, id]) => id),
      ["list", "detail"],
    );

    const panel = world.host.contributions.find(
      (contribution) => contribution.kind === "component",
    );

    assert.equal(panel?.kind === "component" ? panel.placeId : undefined, "core.panel.tabs");
    assert.equal(panel?.kind === "component" ? panel.export : undefined, "SubagentsPanel");

    // Подписка на список сессий — единственный способ узнать, что субагент отработал: хук
    // `turn_finished` молчит на сорвавшемся и на прерванном турне.
    assert.deepEqual(world.host.subscriptions, ["core.sessions.changed"]);
  });

  it("finishes a subagent that ended while the worker was reloading", async () => {
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({
        id: "s-child",
        phase: "idle",
        entries: [agentMessage("e1", "all green", answered)],
      }),
    ]);

    // Запись пережила перезагрузку воркера, память — нет: субагент успел закончить, пока плагина
    // не было. Без обхода при активации запись навсегда осталась бы идущей.
    await writeRecord({
      sessionId: "s-child",
      parentSessionId: "s-parent",
      projectId: "p1",
      agentId: "starter.generic",
      model: "scripted/one",
      thinkingLevel: "off",
      description: "check the tests",
      prompt: "run the tests",
      state: "running",
      startedAt: "2026-08-14T09:00:00.000Z",
    });

    const { activate } = await import("./worker.ts");

    await activate?.();
    // Обход асинхронный: событие шины он тоже обрабатывает не на месте вызова.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const settled = await readRecord("s-child");

    assert.equal(settled?.state, "finished");
    assert.equal(settled?.lastResponse, "all green");
    assert.equal(
      world.calls.some((call) => call.kind === "session-prompt"),
      true,
    );
  });
});
