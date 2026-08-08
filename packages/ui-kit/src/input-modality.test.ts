// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { inputModalityAttribute, trackInputModality } from "./index.ts";

afterEach(() => document.documentElement.removeAttribute(inputModalityAttribute));

describe("input modality tracking", () => {
  it("marks pointer and keyboard input on the document root until tracking stops", () => {
    const stop = trackInputModality(document);

    document.dispatchEvent(new Event("pointerdown"));
    expect(document.documentElement.getAttribute(inputModalityAttribute)).toBe("pointer");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.documentElement.getAttribute(inputModalityAttribute)).toBe("keyboard");

    stop();
    document.dispatchEvent(new Event("pointerdown"));
    expect(document.documentElement.getAttribute(inputModalityAttribute)).toBe("keyboard");
  });
});
