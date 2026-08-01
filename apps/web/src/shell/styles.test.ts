import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { roleNames, rolePropertyName } from "@sovereign/ui-kit";
import { describe, expect, it } from "vitest";

/**
 * Та же дисциплина, что у кита, но для стилей приложения: линтер за CSS не следит, а геометрия хоста —
 * единственный CSS вне кита. Цвет здесь обязан приезжать ролью, размер — шкалой кита, иначе масштаб
 * интерфейса двигает примитивы, а раскладку вокруг них нет (docs/ui-kit.md).
 *
 * Обходится вся директория `src`, а не один файл: второй файл стилей появился вместе со вью входа, и
 * дисциплина, которую надо не забыть распространить руками, — это не дисциплина.
 */

const withoutComments = (source: string): string => source.replaceAll(/\/\*[\s\S]*?\*\//g, "");

const sources = join(import.meta.dirname, "..");

/** Все файлы стилей приложения. Кит проверяет свои сам, у него своя дисциплина. */
function styleSheets(directory: string): { name: string; styles: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return styleSheets(path);
    }

    return entry.name.endsWith(".css")
      ? [{ name: entry.name, styles: withoutComments(readFileSync(path, "utf8")) }]
      : [];
  });
}

const sheets = styleSheets(sources);

/** Общий слой кита: приложение имеет право опираться на его шкалы, но не на его классы. */
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

describe("the style sheets of the application", () => {
  it("are all found", () => {
    // Тест обходит директорию: пустой список означал бы, что он ничего не проверяет и молчит об этом.
    expect(sheets.map((sheet) => sheet.name).sort()).toEqual([
      "login.css",
      "projects.css",
      "providers.css",
      "sessions.css",
      "settings.css",
      "shell.css",
    ]);
  });

  it.each(sheets)("$name takes every colour from a role variable", ({ styles }) => {
    const literals = [
      ...(styles.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(styles.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) ?? []),
    ];

    expect(literals).toEqual([]);
  });

  it.each(sheets)(
    "$name names only roles and scales the kit puts on the document",
    ({ styles }) => {
      const used = new Set(
        [...styles.matchAll(/var\(\s*(--sovereign-[a-z0-9-]+)/g)].map(([, name]) => name ?? ""),
      );
      const known = new Set([...roleNames.map(rolePropertyName), ...kitTokens]);

      expect([...used].filter((name) => !known.has(name))).toEqual([]);
    },
  );

  it.each(sheets)("$name does not reach into the class names of the kit", ({ styles }) => {
    // Имена классов кита хешируются CSS Modules: селектор снаружи по ним не сработает, и раньше
    // такой селектор здесь был (docs/ui-extension-model.md).
    expect(styles).not.toMatch(/\.sv-/);
  });

  it("allows the shell page and session tracks to shrink below their content width", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(shell).toMatch(/\.shell-page\s*\{[^}]*min-width:\s*0;/s);
    expect(sessions).toMatch(/\.sessions-split\s*>\s*\*\s*\{[^}]*min-width:\s*0;/s);
    expect(sessions).toMatch(/\.sessions-composer\s*\{[^}]*flex-wrap:\s*wrap;/s);
  });

  it("stacks the session split by its available width rather than the viewport", () => {
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).toMatch(/\.sessions\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(sessions).toMatch(
      /@container\s*\(width\s*<\s*60rem\)\s*\{[^}]*\.sessions-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(sessions).not.toMatch(/@media\s*\(width\s*<\s*60rem\)/);
  });
});
