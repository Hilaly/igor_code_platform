import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { lastAgentText, notification, reconcile } from "./lifecycle.ts";
import { listRecords, readRecord, writeRecord, type SubagentRecord } from "./registry.ts";
import { agentMessage, installWorld, session, type World } from "./world.test-helper.ts";

let world: World | undefined;

afterEach(() => {
  world?.restore();
  world = undefined;
});

const now = "2026-08-14T10:00:00.000Z";

function record(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  return {
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
    ...overrides,
  };
}

describe("lastAgentText", () => {
  it("takes the last thing the agent said and skips the empty tail", () => {
    assert.equal(
      lastAgentText([
        agentMessage("e1", "first"),
        agentMessage("e2", "  "),
        { id: "e3", time: now, kind: "tools-change", toolNames: ["read"] },
      ]),
      "first",
    );
  });

  it("has nothing to take when the agent never spoke", () => {
    assert.equal(lastAgentText([{ id: "e1", time: now, kind: "leaf" }]), undefined);
  });
});

describe("reconcile", () => {
  it("finishes a running record whose session went idle and tells an idle parent with a turn", async () => {
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({ id: "s-child", phase: "idle", entries: [agentMessage("e1", "all green")] }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const settled = await readRecord("s-child");

    assert.equal(settled?.state, "finished");
    assert.equal(settled?.lastResponse, "all green");
    assert.equal(settled?.notified, true);

    // Простаивающий родитель зовётся турном: догоняющее сообщение он бы не вычитал вовсе — обе
    // очереди рантайма читаются только изнутри идущего турна.
    const told = world.calls.find((call) => call.kind === "session-prompt");

    assert.match(
      told?.kind === "session-prompt" ? (told.turn.text ?? "") : "",
      /Subagent s-child \(check the tests\) finished\./u,
    );
    assert.match(told?.kind === "session-prompt" ? (told.turn.text ?? "") : "", /all green/u);
  });

  it("tells a working parent with a follow-up message instead of a turn", async () => {
    world = installWorld([
      session({ id: "s-parent", phase: "turn" }),
      session({ id: "s-child", phase: "idle", entries: [agentMessage("e1", "all green")] }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const told = world.calls.find((call) => call.kind === "session-message");

    assert.equal(told?.kind === "session-message" ? told.message.mode : undefined, "follow-up");
    assert.equal((await readRecord("s-child"))?.notified, true);
  });

  it("leaves a working subagent alone", async () => {
    world = installWorld([session({ id: "s-parent" }), session({ id: "s-child", phase: "turn" })]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    assert.equal((await readRecord("s-child"))?.state, "running");
    assert.equal(
      world.calls.some((call) => call.kind === "session-prompt"),
      false,
    );
  });

  it("keeps an undelivered notification and sends it on the next sweep", async () => {
    // Родитель стоит в очереди за слотом: турна ещё нет, а простоем это уже не считается, — и он
    // не принимает ни того, ни другого.
    world = installWorld([
      session({ id: "s-parent", phase: "queued" }),
      session({ id: "s-child", phase: "idle", entries: [agentMessage("e1", "all green")] }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const stuck = await readRecord("s-child");

    assert.equal(stuck?.state, "finished");
    assert.notEqual(stuck?.notified, true);

    const parent = world.sessions.get("s-parent");

    if (parent !== undefined) {
      parent.phase = "idle";
    }

    await reconcile(await listRecords(), now);

    assert.equal((await readRecord("s-child"))?.notified, true);
  });

  it("does not tell the parent twice about one subagent", async () => {
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({ id: "s-child", phase: "idle", entries: [agentMessage("e1", "all green")] }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);
    // Родитель после уведомления ушёл в турн; второй обход не обязан ничего досылать.
    await reconcile(await listRecords(), now);

    assert.equal(world.calls.filter((call) => call.kind === "session-prompt").length, 1);
    assert.equal(world.calls.filter((call) => call.kind === "session-message").length, 0);
  });

  it("calls a subagent whose session disappeared failed instead of leaving it running", async () => {
    world = installWorld([session({ id: "s-parent", phase: "idle" })]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const settled = await readRecord("s-child");

    assert.equal(settled?.state, "failed");
    assert.match(settled?.failure ?? "", /the session of the subagent is gone/u);
    assert.equal(settled?.notified, true);
  });

  it("does not lose a subagent whose parent is gone", async () => {
    world = installWorld([
      session({ id: "s-child", phase: "idle", entries: [agentMessage("e1", "all green")] }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const settled = await readRecord("s-child");

    // Звать некого, но работа записана и видна в панели: висеть неотправленным уведомление
    // не остаётся.
    assert.equal(settled?.state, "finished");
    assert.equal(settled?.lastResponse, "all green");
    assert.equal(settled?.notified, true);
  });
});

describe("notification", () => {
  it("names the subagent, its label and its verdict", () => {
    assert.match(
      notification(record({ state: "stopped", lastResponse: "half" })),
      /Subagent s-child \(check the tests\) was stopped\./u,
    );
    assert.match(
      notification(record({ state: "failed", failure: "the model is not available" })),
      /failed\.\n\nthe model is not available/u,
    );
  });
});
