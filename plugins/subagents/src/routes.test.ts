import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { PluginRouteRequest } from "@sovereign/sdk";

import { contributeRoutes, type SubagentDetail, type SubagentListed } from "./routes.ts";
import { writeRecord, type SubagentRecord } from "./registry.ts";
import { agentMessage, installWorld, session, type World } from "./world.test-helper.ts";

let world: World | undefined;

afterEach(() => {
  world?.restore();
  world = undefined;
});

function request(overrides: Partial<PluginRouteRequest> = {}): PluginRouteRequest {
  return {
    method: "GET",
    path: "list",
    parameters: {},
    query: {},
    headers: {},
    public: false,
    ...overrides,
  };
}

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

const bodyOf = <Value>(body: unknown): Value =>
  JSON.parse(typeof body === "string" ? body : "") as Value;

describe("the list route", () => {
  it("gives the records newest first, with the live phase of each session", async () => {
    world = installWorld([session({ id: "s-child", phase: "turn" })]);
    await contributeRoutes();
    await writeRecord(record());
    await writeRecord(
      record({
        sessionId: "s-older",
        description: "older",
        state: "finished",
        startedAt: "2026-08-14T08:00:00.000Z",
      }),
    );

    const answer = await world.host.callRoute("list", request());
    const listed = bodyOf<{ subagents: SubagentListed[] }>(answer.body).subagents;

    assert.deepEqual(
      listed.map((one) => [one.sessionId, one.phase]),
      [
        ["s-child", "turn"],
        // Сессии второй записи в мире нет: запись переживает свою сессию, и фазы у неё просто нет.
        ["s-older", undefined],
      ],
    );
  });

  it("narrows the list to one calling session when asked", async () => {
    world = installWorld();
    await contributeRoutes();
    await writeRecord(record());
    await writeRecord(record({ sessionId: "s-other", parentSessionId: "s-elsewhere" }));

    const answer = await world.host.callRoute("list", request({ query: { parent: "s-parent" } }));

    assert.deepEqual(
      bodyOf<{ subagents: SubagentListed[] }>(answer.body).subagents.map((one) => one.sessionId),
      ["s-child"],
    );
  });
});

describe("the detail route", () => {
  it("gives the record together with its branch and its spend", async () => {
    world = installWorld([session({ id: "s-child", entries: [agentMessage("e1", "all green")] })]);
    await contributeRoutes();
    await writeRecord(record());

    const answer = await world.host.callRoute(
      "detail",
      request({ path: "detail/:sessionId", parameters: { sessionId: "s-child" } }),
    );
    const detail = bodyOf<SubagentDetail>(answer.body);

    assert.equal(detail.record.description, "check the tests");
    assert.equal(detail.entries.length, 1);
    assert.equal(detail.stats?.totalTokens, 10);
  });

  it("shows the record and names the reason when its session cannot be read", async () => {
    world = installWorld();
    await contributeRoutes();
    await writeRecord(record());

    const answer = await world.host.callRoute(
      "detail",
      request({ path: "detail/:sessionId", parameters: { sessionId: "s-child" } }),
    );
    const detail = bodyOf<SubagentDetail>(answer.body);

    // Пустая лента без причины читалась бы как «субагент ничего не делал».
    assert.equal(detail.record.sessionId, "s-child");
    assert.match(detail.problem ?? "", /there is no session s-child/u);
  });

  it("answers 404 for a subagent nobody started", async () => {
    world = installWorld();
    await contributeRoutes();

    const answer = await world.host.callRoute(
      "detail",
      request({ path: "detail/:sessionId", parameters: { sessionId: "s-none" } }),
    );

    assert.equal(answer.status, 404);
  });
});
