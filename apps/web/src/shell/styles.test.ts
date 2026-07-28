import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { roleNames, rolePropertyName } from "@sovereign/ui-kit";
import { describe, expect, it } from "vitest";

/**
 * Та же дисциплина, что у кита, но для стилей оболочки: линтер за CSS не следит, а геометрия хоста —
 * единственный CSS вне кита. Цвет здесь обязан приезжать ролью, размер — шкалой кита, иначе масштаб
 * интерфейса двигает примитивы, а раскладку вокруг них нет (docs/ui-kit.md).
 */

const withoutComments = (source: string): string => source.replaceAll(/\/\*[\s\S]*?\*\//g, "");

const styles = withoutComments(readFileSync(join(import.meta.dirname, "shell.css"), "utf8"));

/** Общий слой кита: оболочка имеет право опираться на его шкалы, но не на его классы. */
const kitStyles = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "ui-kit",
  "src",
  "styles",
);

const kitTokens = new Set(
  readdirSync(kitStyles)
    .filter((name) => name.endsWith(".css"))
    .flatMap((name) =>
      [
        ...withoutComments(readFileSync(join(kitStyles, name), "utf8")).matchAll(
          /(--sovereign-[a-z0-9-]+)\s*:/g,
        ),
      ].map(([, token]) => token ?? ""),
    ),
);

describe("shell.css", () => {
  it("takes every colour from a role variable", () => {
    const literals = [
      ...(styles.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(styles.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) ?? []),
    ];

    expect(literals).toEqual([]);
  });

  it("names only roles and scales the kit puts on the document", () => {
    const used = new Set(
      [...styles.matchAll(/var\(\s*(--sovereign-[a-z0-9-]+)/g)].map(([, name]) => name ?? ""),
    );
    const known = new Set([...roleNames.map(rolePropertyName), ...kitTokens]);

    expect([...used].filter((name) => !known.has(name))).toEqual([]);
  });

  it("does not reach into the class names of the kit", () => {
    // Имена классов кита хешируются CSS Modules: селектор снаружи по ним не сработает, и раньше
    // такой селектор здесь был (docs/ui-extension-model.md).
    expect(styles).not.toMatch(/\.sv-/);
  });
});
