import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./projects.css", import.meta.url), "utf8");

describe("project layout styles", () => {
  it("lets index and detail content respond to their settings container", () => {
    expect(styles).toMatch(/\.projects\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(styles).toMatch(
      /\.project-detail-rows\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;/s,
    );
    expect(styles).toMatch(/@container\s*\(width\s*<=\s*42rem\)/s);
  });

  it("leaves row geometry to the UI kit while allowing long paths to shrink", () => {
    expect(styles).not.toMatch(/\.projects-row\s*\{/s);
    expect(styles).toMatch(
      /\.projects-row-folder\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s,
    );
  });
});
