/** Text helpers for immediate config controls, tested without React. */

import { defaultConfig } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { parseFiniteNumber, textOf } from "./config-draft.ts";

describe("the config control text", () => {
  it("uses the daemon snapshot as text for every control", () => {
    expect(textOf(defaultConfig).maxConcurrentTurns).toBe("4");
    expect(textOf(defaultConfig).logLevel).toBe(defaultConfig.logLevel);
  });

  it("parses a finite numeric string", () => {
    expect(parseFiniteNumber("0.75")).toBe(0.75);
  });

  it("refuses empty and non-finite numeric text", () => {
    expect(parseFiniteNumber("  ")).toBeUndefined();
    expect(parseFiniteNumber("Infinity")).toBeUndefined();
    expect(parseFiniteNumber("полтора")).toBeUndefined();
  });
});
