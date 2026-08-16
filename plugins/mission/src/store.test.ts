import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";

import { readMission, writeMission } from "./store.ts";

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
});
