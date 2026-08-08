import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./projects.css", import.meta.url), "utf8");

describe("project layout styles", () => {
  it("lets index and detail content respond to their settings container", () => {
    expect(styles).toMatch(/\.projects\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(styles).toMatch(
      /\.project-detail-rows\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;/s,
    );
    expect(styles).toMatch(
      /@container\s*\(width\s*<=\s*42rem\)[\s\S]*\.projects-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
  });

  it("keeps selectable rows dense while allowing long paths to shrink", () => {
    expect(styles).toMatch(
      /\.projects-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;[^}]*min-width:\s*0;/s,
    );
    expect(styles).toMatch(
      /\.projects-row-facts\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s,
    );
  });
});
