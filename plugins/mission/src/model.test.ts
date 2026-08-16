import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateMissionInput } from "./model.ts";

describe("mission input", () => {
  it("trims the mission, explanation, and steps", () => {
    assert.deepEqual(
      validateMissionInput({
        mission: "  Ship it  ",
        explanation: "  Keep the scope tight  ",
        plan: [{ step: "  Write tests  ", status: "in_progress" }],
      }),
      {
        mission: "Ship it",
        explanation: "Keep the scope tight",
        plan: [{ step: "Write tests", status: "in_progress" }],
      },
    );
  });

  it("rejects empty missions, plans, steps, and explanations", () => {
    for (const value of [
      { mission: "", plan: [{ step: "x", status: "pending" }] },
      { mission: "x", plan: [] },
      { mission: "x", plan: [{ step: "", status: "pending" }] },
      { mission: "x", explanation: " ", plan: [{ step: "x", status: "pending" }] },
    ]) {
      assert.throws(() => validateMissionInput(value));
    }
  });

  it("rejects unknown keys, statuses, and multiple active steps", () => {
    assert.throws(() =>
      validateMissionInput({
        mission: "x",
        plan: [{ step: "x", status: "pending" }],
        extra: true,
      }),
    );
    assert.throws(() =>
      validateMissionInput({ mission: "x", plan: [{ step: "x", status: "blocked" }] }),
    );
    assert.throws(() =>
      validateMissionInput({
        mission: "x",
        plan: [
          { step: "a", status: "in_progress" },
          { step: "b", status: "in_progress" },
        ],
      }),
    );
  });
});
