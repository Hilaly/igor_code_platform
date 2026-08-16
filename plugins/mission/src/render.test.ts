import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MissionSnapshot } from "./model.ts";
import { renderSnapshot } from "./render.ts";

const snapshot: MissionSnapshot = {
  mission: "Ship the mission plugin",
  explanation: "Tests are green, the docs are next",
  plan: [
    { step: "Read the code", status: "completed" },
    { step: "Write the tests", status: "in_progress" },
    { step: "Push", status: "blocked", reason: "no credentials in this worktree" },
    { step: "Delete the branch", status: "skipped", reason: "the owner keeps it" },
    { step: "Report", status: "pending" },
  ],
  revision: 4,
  updatedAt: "2026-08-16T08:51:10.685Z",
};

describe("rendered snapshot", () => {
  it("shows the revision, the goal, the note, and every step with its status", () => {
    assert.equal(
      renderSnapshot(snapshot),
      [
        "Mission revision 4, updated 2026-08-16T08:51:10.685Z",
        "Goal: Ship the mission plugin",
        "Note: Tests are green, the docs are next",
        "Plan: 1 of 5 completed",
        "  1. [completed] Read the code",
        "  2. [in_progress] Write the tests",
        "  3. [blocked] Push (reason: no credentials in this worktree)",
        "  4. [skipped] Delete the branch (reason: the owner keeps it)",
        "  5. [pending] Report",
      ].join("\n"),
    );
  });

  it("leaves out the note when there is none and shows the outcome when there is one", () => {
    const rendered = renderSnapshot({
      mission: "Ship it",
      plan: [{ step: "Build", status: "completed" }],
      outcome: { kind: "succeeded", summary: "green on main" },
      revision: 9,
      updatedAt: "2026-08-16T09:00:00.000Z",
    });

    assert.equal(rendered.includes("Note:"), false);
    assert.match(rendered, /^Outcome: succeeded — green on main$/mu);
  });
});
