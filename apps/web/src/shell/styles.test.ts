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

/** Production entrypoint обязан загрузить каждую найденную прикладную таблицу, иначе тест правил
 *  читает CSS, которого в интерфейсе нет, и создаёт ложную уверенность. */
const entrypoint = readFileSync(join(sources, "main.tsx"), "utf8");

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

  it("are all loaded by the production entrypoint", () => {
    const loaded = [...entrypoint.matchAll(/import\s+"\.\/[^"/]+\/([^"/]+\.css)";/g)]
      .map(([, name]) => name ?? "")
      .sort();

    expect(loaded).toEqual(sheets.map((sheet) => sheet.name).sort());
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

  it("allows the shell page, sidebar tree, and direct chat to shrink or scroll", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(shell).toMatch(/\.shell-page\s*\{[^}]*min-width:\s*0;/s);
    expect(shell).toMatch(/\.shell-projects\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*min-width:\s*0;/s);
    expect(sessions).toMatch(/\.sessions-composer\s*\{[^}]*flex-wrap:\s*wrap;/s);
  });

  it("separates shell surfaces and keeps the sidebar compact", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";

    expect(shell).toMatch(/\.shell-left\s*\{[^}]*background:\s*var\(--sovereign-panel-surface\);/s);
    expect(shell).toMatch(/\.shell-page\s*\{[^}]*background:\s*var\(--sovereign-page-surface\);/s);
    expect(shell).toMatch(
      /\.shell-right\s*\{[^}]*background:\s*var\(--sovereign-sunken-surface\);/s,
    );
    expect(shell).toMatch(/\.shell-left\s*\{[^}]*gap:\s*var\(--sovereign-space-2\);/s);
  });

  it("keeps direct session content sized by its available container", () => {
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).toMatch(/\.sessions\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*min-height:\s*0;/s);
    expect(sessions).not.toMatch(/\.sessions-split/);
    expect(sessions).not.toMatch(/@media\s*\(width\s*<\s*60rem\)/);
  });

  it("keeps settings split by their container and scrolls the active content", () => {
    const settings = sheets.find((sheet) => sheet.name === "settings.css")?.styles ?? "";

    expect(settings).toMatch(/\.settings\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(settings).toMatch(/\.settings-layout\s*\{[^}]*grid-template-columns:[^;}]+;/s);
    expect(settings).toMatch(/\.settings-content-body\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(settings).toMatch(
      /@container\s*\(width\s*<\s*40rem\)\s*\{[\s\S]*?\.settings-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(settings).toMatch(/\.settings-nav\s*>\s*ul\s*\{[^}]*flex-direction:\s*row;/s);
    expect(settings).not.toMatch(/\.settings-split/);
  });

  it("keeps settings compact, divided, and flat", () => {
    const settings = sheets.find((sheet) => sheet.name === "settings.css")?.styles ?? "";

    expect(settings).toMatch(
      /\.settings-nav\s*>\s*ul\s*>\s*li\s*\{[^}]*min-height:\s*var\(--sovereign-row-height-compact\);/s,
    );
    expect(settings).toMatch(
      /\.settings-(?:appearance|daemon)\s*>\s*\*\s*\+\s*\*[^{]*\{[^}]*border-block-start:\s*var\(--sovereign-stroke-thin\)\s+solid\s+var\(--sovereign-border-subtle\);/s,
    );
    expect(settings).not.toMatch(
      /\.settings[^{]*\{[^}]*(?:box-shadow:\s*var\(--sovereign-elevation-|border-radius:\s*var\(--sovereign-radius-(?:sm|md|lg|xl))/s,
    );
  });
});
