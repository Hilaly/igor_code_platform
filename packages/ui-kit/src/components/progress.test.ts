import { describe, expect, it } from "vitest";

import { clampProgressValue, progressPercent } from "./progress.tsx";

describe("clampProgressValue", () => {
  it("passes a share inside the range through untouched", () => {
    expect(clampProgressValue(0)).toBe(0);
    expect(clampProgressValue(0.42)).toBe(0.42);
    expect(clampProgressValue(1)).toBe(1);
  });

  it("pulls a share outside the range back to the border", () => {
    expect(clampProgressValue(-0.5)).toBe(0);
    expect(clampProgressValue(4)).toBe(1);
    expect(clampProgressValue(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampProgressValue(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("reads a share that is not a number as nothing done", () => {
    expect(clampProgressValue(Number.NaN)).toBe(0);
  });
});

describe("progressPercent", () => {
  it("reports whole percent, not the fraction it was given", () => {
    expect(progressPercent(0.4237)).toBe(42);
    expect(progressPercent(1 / 3)).toBe(33);
  });

  it("reports the borders as nothing and everything", () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(1)).toBe(100);
  });

  it("clamps before it counts", () => {
    expect(progressPercent(2.5)).toBe(100);
    expect(progressPercent(-1)).toBe(0);
    expect(progressPercent(Number.NaN)).toBe(0);
  });
});
