import { coreEventTypes, streamGapType, type FileResourcesSnapshot } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyContributionEvent,
  applyFileResourcesFailure,
  applyFileResourcesSnapshot,
  initialFileResourcesState,
} from "./file-resources-state.ts";

const snapshot = (revision: number): FileResourcesSnapshot => ({
  revision,
  resources: [],
  diagnostics: [],
});

describe("file resources state", () => {
  it("marks the snapshot stale and asks for a refetch on a contribution invalidation", () => {
    const shown = applyFileResourcesSnapshot(initialFileResourcesState, snapshot(8));
    const outcome = applyContributionEvent(shown, {
      index: 12,
      time: "2026-08-03T00:00:00.000Z",
      type: coreEventTypes.contributionsChanged,
      payload: { revision: 9 },
    });

    expect(outcome).toEqual({
      state: { ...shown, stale: true, requiredRevision: 9 },
      refetch: true,
    });
  });

  it("does not apply an older response after a newer snapshot", () => {
    const shown = applyFileResourcesSnapshot(initialFileResourcesState, snapshot(9));

    expect(applyFileResourcesSnapshot(shown, snapshot(8))).toBe(shown);
  });

  it("does not apply a response older than the invalidating event", () => {
    const invalidated = applyContributionEvent(initialFileResourcesState, {
      index: 12,
      time: "2026-08-03T00:00:00.000Z",
      type: coreEventTypes.contributionsChanged,
      payload: { revision: 9 },
    }).state;

    expect(applyFileResourcesSnapshot(invalidated, snapshot(8))).toBe(invalidated);
    expect(applyFileResourcesSnapshot(invalidated, snapshot(9))).toEqual({
      snapshot: snapshot(9),
      stale: false,
    });
  });

  it("asks for a fresh snapshot after a stream gap", () => {
    const shown = applyFileResourcesSnapshot(initialFileResourcesState, snapshot(9));
    const outcome = applyContributionEvent(shown, {
      index: 13,
      time: "2026-08-03T00:00:01.000Z",
      type: streamGapType,
      payload: { requestedIndex: 2, oldestIndex: 10 },
    });

    expect(outcome.refetch).toBe(true);
    expect(outcome.state.stale).toBe(true);
  });

  it("keeps the shown snapshot while exposing a read failure", () => {
    const shown = applyFileResourcesSnapshot(initialFileResourcesState, snapshot(3));

    expect(applyFileResourcesFailure(shown, "unavailable")).toEqual({
      ...shown,
      failure: "unavailable",
    });
  });
});
