// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inputModalityAttribute, trackInputModality } from "@sovereign/ui-kit";
import { afterEach, describe, expect, it } from "vitest";

const sessions = readFileSync(join(import.meta.dirname, "sessions.css"), "utf8");

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute(inputModalityAttribute);
});

describe("the saved message action reveal", () => {
  it("ignores pointer focus after hover-out and reveals actions for keyboard focus", () => {
    const style = document.createElement("style");
    style.textContent = sessions;
    document.head.append(style);
    document.body.innerHTML = `
      <div class="sessions-entry-message">
        <div class="sessions-entry-meta"><button>Copy</button></div>
      </div>
    `;
    const action = document.querySelector("button");
    const actions = document.querySelector(".sessions-entry-meta");

    if (action === null || actions === null) {
      throw new Error("the message action focus fixture is incomplete");
    }

    const stop = trackInputModality(document);

    action.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    action.focus();
    expect(actions.matches(":focus-within")).toBe(true);
    expect(getComputedStyle(actions).opacity).toBe("0");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(getComputedStyle(actions).opacity).toBe("1");

    stop();
  });
});
