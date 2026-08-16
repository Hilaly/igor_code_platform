import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";

import { MissionConflictError, readMission, writeMission } from "./store.ts";

let host: PluginTestHost | undefined;

afterEach(() => {
  host?.restore();
  host = undefined;
});

const input = (mission: string) => ({
  mission,
  plan: [{ step: "Implement", status: "in_progress" as const }],
});

describe("mission storage", () => {
  it("keeps independent per-session snapshots and increments revisions", async () => {
    host = installTestHost({ id: "mission" });

    const first = await writeMission("session-a", input("First"));
    const second = await writeMission("session-a", input("Second"));
    await writeMission("session-b", input("Other"));

    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    assert.equal((await readMission("session-a"))?.mission, "Second");
    assert.equal((await readMission("session-b"))?.mission, "Other");
    assert.equal(await readMission("missing"), undefined);
    assert.match(second.updatedAt, /^\d{4}-\d\d-\d\dT/u);
  });

  it("uses the canonical mission.<sessionId> storage key", async () => {
    host = installTestHost({ id: "mission" });
    await writeMission("s-1", input("A"));

    assert.deepEqual([...host.stored.keys()], ["mission.s-1"]);
  });

  it("serializes concurrent writes for one session", async () => {
    host = installTestHost({ id: "mission" });
    const [first, second] = await Promise.all([
      writeMission("same", input("First")),
      writeMission("same", input("Second")),
    ]);

    assert.deepEqual([first.revision, second.revision].sort(), [1, 2]);
    assert.equal((await readMission("same"))?.revision, 2);
  });

  it("continues a session queue after an earlier write fails", async () => {
    host = installTestHost({ id: "mission" });
    host.failNextStorage("disk full");

    const failed = writeMission("same", input("Failed"));
    const recovered = writeMission("same", input("Recovered"));

    await assert.rejects(failed, /disk full/u);
    assert.equal((await recovered).revision, 1);
    assert.equal((await readMission("same"))?.mission, "Recovered");
  });

  it("stores a blocked step together with its reason and the mission outcome", async () => {
    host = installTestHost({ id: "mission" });

    const written = await writeMission("s", {
      mission: "Ship",
      plan: [{ step: "Push", status: "blocked" as const, reason: "no credentials" }],
      outcome: { kind: "failed" as const, summary: "could not push" },
    });

    assert.deepEqual((await readMission("s"))?.plan, written.plan);
    assert.equal((await readMission("s"))?.outcome?.kind, "failed");
  });

  it("does not keep expectedRevision in the stored snapshot", async () => {
    host = installTestHost({ id: "mission" });

    const written = await writeMission("s", { ...input("A"), expectedRevision: 0 });

    assert.equal("expectedRevision" in written, false);
    assert.equal("expectedRevision" in (host.stored.get("mission.s") as object), false);
  });

  it("refuses a write whose expectedRevision lost the race and keeps the stored snapshot", async () => {
    host = installTestHost({ id: "mission" });
    await writeMission("s", input("First"));
    await writeMission("s", input("Second"));

    const refused = writeMission("s", { ...input("Third"), expectedRevision: 1 });

    await assert.rejects(refused, (cause: unknown) => {
      assert.ok(cause instanceof MissionConflictError);
      assert.equal(cause.expectedRevision, 1);
      assert.equal(cause.current?.revision, 2);
      assert.equal(cause.current?.mission, "Second");

      return true;
    });
    assert.equal((await readMission("s"))?.mission, "Second");
    assert.equal((await readMission("s"))?.revision, 2);
  });

  it("treats expectedRevision 0 as a claim that no mission exists", async () => {
    host = installTestHost({ id: "mission" });

    const first = await writeMission("s", { ...input("First"), expectedRevision: 0 });
    const second = writeMission("s", { ...input("Second"), expectedRevision: 0 });

    assert.equal(first.revision, 1);
    await assert.rejects(second, MissionConflictError);
  });

  it("refuses a non-zero expectedRevision when there is no mission yet", async () => {
    host = installTestHost({ id: "mission" });

    await assert.rejects(
      writeMission("s", { ...input("First"), expectedRevision: 3 }),
      (cause: unknown) => {
        assert.ok(cause instanceof MissionConflictError);
        assert.equal(cause.current, undefined);

        return true;
      },
    );
    assert.equal(host.stored.size, 0);
  });
});
