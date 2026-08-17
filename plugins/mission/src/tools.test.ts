import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";

import { contributeTools } from "./tools.ts";

let host: PluginTestHost | undefined;

afterEach(() => {
  host?.restore();
  host = undefined;
});

describe("mission-update", () => {
  it("uses the invocation session and publishes after writing", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();

    const outcome = await host.callTool(
      "mission-update",
      { mission: "Ship", plan: [{ step: "Test", status: "completed" }] },
      { sessionId: "session-42" },
    );

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /revision 1/u);
    assert.deepEqual(host.published, [
      { declaredId: "changed", payload: { sessionId: "session-42", revision: 1 } },
    ]);
    assert.equal((host.stored.get("mission.session-42") as { mission: string }).mission, "Ship");
  });

  it("hands the stored snapshot back so the writer sees what was written", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();

    const outcome = await host.callTool(
      "mission-update",
      {
        mission: "Ship",
        plan: [
          { step: "Build", status: "completed" },
          { step: "Push", status: "blocked", reason: "no credentials" },
        ],
      },
      { sessionId: "s" },
    );

    assert.match(outcome.content, /^Goal: Ship$/mu);
    assert.match(outcome.content, /^ {2}1\. \[completed\] Build$/mu);
    assert.match(outcome.content, /^ {2}2\. \[blocked\] Push \(reason: no credentials\)$/mu);
  });

  it("warns when the rewrite drops steps that were completed", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();
    await host.callTool(
      "mission-update",
      {
        mission: "Ship",
        plan: [
          { step: "Build", status: "completed" },
          { step: "Test", status: "completed" },
        ],
      },
      { sessionId: "s" },
    );

    const outcome = await host.callTool(
      "mission-update",
      { mission: "Ship", plan: [{ step: "Build", status: "completed" }] },
      { sessionId: "s" },
    );

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /Warning: 1 step\(s\) completed in revision 1 are gone/u);
    assert.match(outcome.content, /"Test"/u);
  });

  it("refuses a stale expectedRevision and returns the snapshot to merge into", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();
    await host.callTool(
      "mission-update",
      { mission: "First", plan: [{ step: "Build", status: "pending" }] },
      { sessionId: "s" },
    );

    const outcome = await host.callTool(
      "mission-update",
      {
        mission: "Second",
        plan: [{ step: "Build", status: "completed" }],
        expectedRevision: 7,
      },
      { sessionId: "s" },
    );

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /Mission update refused/u);
    assert.match(outcome.content, /expectedRevision 1/u);
    assert.match(outcome.content, /^Goal: First$/mu);
    // Отказ ничего не пишет и никого не будит: снимок прежний, событие одно — от первой записи.
    assert.equal((host.stored.get("mission.s") as { mission: string }).mission, "First");
    assert.equal(host.published.length, 1);
  });

  it("advises retrying with expectedRevision 0 when no mission exists", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();

    const outcome = await host.callTool(
      "mission-update",
      {
        mission: "First",
        plan: [{ step: "Build", status: "pending" }],
        expectedRevision: 3,
      },
      { sessionId: "new" },
    );

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /expectedRevision 0/u);
    assert.match(outcome.content, /no mission yet/u);
    assert.doesNotMatch(outcome.content, /changed under you/u);
    assert.doesNotMatch(outcome.content, /without expectedRevision\b/u);
    assert.equal(host.stored.size, 0);
    assert.deepEqual(host.published, []);
  });

  it("rejects invalid input before writing or publishing", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();

    const outcome = await host.callTool(
      "mission-update",
      { mission: "", plan: [] },
      { sessionId: "s" },
    );

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /Mission update failed/u);
    assert.equal(host.stored.size, 0);
    assert.deepEqual(host.published, []);
  });

  it("does not publish when storage fails", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();
    host.failNextStorage("disk full");

    const outcome = await host.callTool(
      "mission-update",
      { mission: "Ship", plan: [{ step: "Test", status: "pending" }] },
      { sessionId: "s" },
    );

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /disk full/u);
    assert.equal(host.stored.size, 0);
    assert.deepEqual(host.published, []);
  });
});

describe("mission-read", () => {
  it("returns the snapshot stored for the calling session", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();
    await host.callTool(
      "mission-update",
      { mission: "Ship", plan: [{ step: "Build", status: "in_progress" }] },
      { sessionId: "mine" },
    );

    const outcome = await host.callTool("mission-read", {}, { sessionId: "mine" });

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /^Goal: Ship$/mu);
    assert.match(outcome.content, /revision 1/u);
  });

  it("does not read another session's mission", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();
    await host.callTool(
      "mission-update",
      { mission: "Ship", plan: [{ step: "Build", status: "in_progress" }] },
      { sessionId: "theirs" },
    );

    const outcome = await host.callTool("mission-read", {}, { sessionId: "mine" });

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /no mission for this session yet/u);
  });

  it("reports a storage failure instead of pretending there is no mission", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();
    host.failNextStorage("disk gone");

    const outcome = await host.callTool("mission-read", {}, { sessionId: "s" });

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /Mission read failed: .*disk gone/u);
  });
});
