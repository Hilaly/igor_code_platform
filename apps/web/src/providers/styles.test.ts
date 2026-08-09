import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./providers.css", import.meta.url), "utf8");

describe("provider layout styles", () => {
  it("gives list, detail, and form views container-owned geometry", () => {
    expect(styles).toMatch(/\.providers\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(styles).toMatch(
      /\.providers-detail-rows\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;/s,
    );
    expect(styles).toMatch(
      /\.provider-form-page\s*\{[^}]*min-width:\s*0;[^}]*container-type:\s*inline-size;/s,
    );
  });

  it("leaves provider row geometry to the UI kit", () => {
    expect(styles).not.toMatch(/\.providers-row\s*\{/s);
    expect(styles).not.toMatch(/\.providers-row-facts\s*\{/s);
    expect(styles).not.toMatch(/\.providers-row-marks\s*\{/s);
    expect(styles).toMatch(/\.providers-model-facts\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  });
});
