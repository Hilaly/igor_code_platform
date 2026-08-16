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
      validateMissionInput({ mission: "x", plan: [{ step: "x", status: "done" }] }),
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

  it("takes blocked and skipped steps that carry a reason", () => {
    const parsed = validateMissionInput({
      mission: "Ship",
      plan: [
        { step: "Push", status: "blocked", reason: "no credentials here" },
        { step: "Delete the branch", status: "skipped", reason: "the owner keeps it" },
      ],
    });

    assert.deepEqual(
      parsed.plan.map((step) => step.status),
      ["blocked", "skipped"],
    );
  });

  it("requires a reason exactly where the status is a deviation", () => {
    assert.throws(
      () => validateMissionInput({ mission: "x", plan: [{ step: "Push", status: "blocked" }] }),
      /must carry a reason/u,
    );
    assert.throws(
      () => validateMissionInput({ mission: "x", plan: [{ step: "Push", status: "skipped" }] }),
      /must carry a reason/u,
    );
    assert.throws(
      () =>
        validateMissionInput({
          mission: "x",
          plan: [{ step: "Push", status: "completed", reason: "went fine" }],
        }),
      /only blocked and skipped steps carry a reason/u,
    );
  });

  it("keeps an outcome and an unfinished step apart", () => {
    assert.throws(
      () =>
        validateMissionInput({
          mission: "x",
          plan: [{ step: "Push", status: "in_progress" }],
          outcome: { kind: "failed", summary: "ran out of time" },
        }),
      /no in_progress step/u,
    );
  });

  it("lets a mission succeed only when every step is completed or skipped", () => {
    assert.throws(
      () =>
        validateMissionInput({
          mission: "x",
          plan: [
            { step: "Build", status: "completed" },
            { step: "Push", status: "blocked", reason: "no credentials" },
          ],
          outcome: { kind: "succeeded", summary: "shipped" },
        }),
      /record the outcome as failed/u,
    );

    const failed = validateMissionInput({
      mission: "x",
      plan: [
        { step: "Build", status: "completed" },
        { step: "Push", status: "blocked", reason: "no credentials" },
      ],
      outcome: { kind: "failed", summary: "could not push" },
    });
    const succeeded = validateMissionInput({
      mission: "x",
      plan: [
        { step: "Build", status: "completed" },
        { step: "Push", status: "skipped", reason: "the owner pushes it" },
      ],
      outcome: { kind: "succeeded", summary: "built and handed over" },
    });

    assert.equal(failed.outcome?.kind, "failed");
    assert.equal(succeeded.outcome?.kind, "succeeded");
  });
});
