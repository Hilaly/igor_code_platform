import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { roleNames, rolePropertyName } from "../tokens/roles.ts";

const styles = readFileSync(join(import.meta.dirname, "..", "styles.css"), "utf8");

/**
 * Линтер следит за цветовыми литералами в коде, но не в CSS (eslint.config.js). Здесь та же проверка
 * для файла стилей: цвет мимо токена не переключается ни при смене варианта, ни при смене схемы, и
 * находится он на чужой схеме, а не у нас (docs/ui-kit.md).
 */
describe("styles.css", () => {
  it("takes every colour from a role variable", () => {
    const literals = styles.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g);

    expect(literals ?? []).toEqual([]);
  });

  it("names only roles the kit derives", () => {
    const used = new Set(styles.match(/--sovereign-[a-z-]+/g));
    const declared = new Set(roleNames.map(rolePropertyName));

    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("dresses every primitive it ships", () => {
    for (const className of [
      "sv-text",
      "sv-heading",
      "sv-button",
      "sv-toggle",
      "sv-select",
      "sv-badge",
      "sv-panel",
      "sv-list",
      "sv-notice",
      "sv-disclosure",
      "sv-code",
      "sv-empty",
      "sv-spinner",
    ]) {
      expect(styles, className).toContain(`.${className} {`);
    }
  });
});
