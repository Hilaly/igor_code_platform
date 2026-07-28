import { describe, expect, it } from "vitest";

import { nextEnabledIndex } from "./roving-focus.ts";

describe("nextEnabledIndex", () => {
  it("steps to the neighbour in either direction", () => {
    const items = [{}, {}, {}];

    expect(nextEnabledIndex(items, 1, 1)).toBe(2);
    expect(nextEnabledIndex(items, 1, -1)).toBe(0);
  });

  it("wraps around both ends", () => {
    const items = [{}, {}, {}];

    expect(nextEnabledIndex(items, 2, 1)).toBe(0);
    expect(nextEnabledIndex(items, 0, -1)).toBe(2);
  });

  it("skips a run of disabled items", () => {
    const items = [{}, { disabled: true }, { disabled: true }, {}];

    expect(nextEnabledIndex(items, 0, 1)).toBe(3);
    expect(nextEnabledIndex(items, 3, -1)).toBe(0);
  });

  it("reads an out-of-range start as the edge of the set", () => {
    const items = [{ disabled: true }, {}, {}, { disabled: true }];

    expect(nextEnabledIndex(items, -1, 1)).toBe(1);
    expect(nextEnabledIndex(items, items.length, -1)).toBe(2);
  });

  it("returns the current index when it is the only enabled item", () => {
    const items = [{ disabled: true }, {}, { disabled: true }];

    expect(nextEnabledIndex(items, 1, 1)).toBe(1);
    expect(nextEnabledIndex(items, 1, -1)).toBe(1);
  });

  it("reports no target for an empty set and for one that is disabled throughout", () => {
    expect(nextEnabledIndex([], 0, 1)).toBeUndefined();
    expect(nextEnabledIndex([{ disabled: true }, { disabled: true }], 0, 1)).toBeUndefined();
  });
});
