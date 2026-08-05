// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const sessions = readFileSync(join(import.meta.dirname, "sessions.css"), "utf8");

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("the saved message action reveal", () => {
  it("is not held open by focus on a tool call", () => {
    const style = document.createElement("style");
    style.textContent = sessions;
    document.head.append(style);
    document.body.innerHTML = `
      <div class="sessions-entry-message">
        <details><summary>Tool call</summary></details>
        <div class="sessions-entry-meta"><button>Copy</button></div>
      </div>
    `;
    const toolSummary = document.querySelector("summary");
    const action = document.querySelector("button");
    const actions = document.querySelector(".sessions-entry-meta");

    if (toolSummary === null || action === null || actions === null) {
      throw new Error("the message action focus fixture is incomplete");
    }

    toolSummary.focus();
    expect(getComputedStyle(actions).opacity).toBe("0");

    action.focus();
    expect(actions.matches(":focus-within")).toBe(true);
  });
});
