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

  it("starts input modality tracking before rendering the application", () => {
    expect(entrypoint).toMatch(
      /trackInputModality\(document\);[\s\S]*createRoot\(container\)\.render/,
    );
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

  it.each(sheets)("$name leaves visual-system properties to UI Kit", ({ styles }) => {
    expect(styles).not.toMatch(/\bfont-family\s*:/);
    const withoutScrollbarThumbRadius = styles.replace(
      /\.sessions-composer\s*>\s*textarea::-webkit-scrollbar-thumb\s*\{[^}]*\}/s,
      "",
    );
    expect(withoutScrollbarThumbRadius).not.toMatch(/\bborder-radius\s*:/);
    expect(styles).not.toMatch(/\bbox-shadow\s*:/);
    expect(styles).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
    expect(styles).not.toMatch(/\bbackdrop-filter\s*:/);
  });

  it("allows the shell page, sidebar tree, and direct chat to shrink or scroll", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(shell).toMatch(/\.shell-page\s*\{[^}]*min-width:\s*0;/s);
    expect(shell).toMatch(/\.shell-left-projects\s*\{[^}]*overflow-x:\s*hidden;/s);
    expect(shell).toMatch(/\.shell-left-projects\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(shell).toMatch(/\.shell-left,\s*\.shell-right\s*\{[^}]*overflow:\s*hidden;/s);
    expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*min-width:\s*0;/s);
    expect(sessions).toMatch(
      /\.sessions-composer\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*minmax\(0,\s*auto\)\s+auto;/s,
    );
    expect(sessions).toMatch(
      /\.sessions-composer-toolbar\s*\{[^}]*justify-content:\s*space-between;/s,
    );
    expect(sessions).toMatch(
      /\.sessions-composer\s*>\s*textarea\s*\{[^}]*scrollbar-width:\s*thin;/s,
    );
    expect(sessions).not.toMatch(/\.sessions-composer(?:-surface)?\s*\{[^}]*overflow\s*:/s);
  });

  it("keeps overflow scoped to the textarea", () => {
    const sessions = readFileSync(join(import.meta.dirname, "../sessions/sessions.css"), "utf8");

    expect(sessions).toMatch(/\.sessions-composer\s*\{[^}]*display:\s*grid;/s);
    expect(sessions).toMatch(
      /\.sessions-composer\s*>\s*textarea\s*\{[^}]*scrollbar-width:\s*thin;/s,
    );
    expect(sessions).toMatch(/\.sessions-composer\s*>\s*textarea::-webkit-scrollbar-thumb/);
    expect(sessions).not.toMatch(/\.sessions-composer\s*\{[^}]*overflow(?:-y)?\s*:/s);
    expect(sessions).not.toMatch(/\.sessions-composer-surface\s*\{[^}]*overflow(?:-y)?\s*:/s);
  });

  it("keeps the compact action group within the composer on narrow containers", () => {
    const sessions = readFileSync(join(import.meta.dirname, "../sessions/sessions.css"), "utf8");

    expect(sessions).toMatch(
      /\.sessions-composer-actions\s*\{[^}]*justify-content:\s*flex-end;[^}]*max-width:\s*100%;[^}]*flex-wrap:\s*nowrap;/s,
    );
    expect(sessions).toMatch(
      /\.sessions-composer-future-slot\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-width:\s*0;/s,
    );
    expect(sessions).not.toMatch(/\.sessions-modes/);
    expect(sessions).not.toMatch(/\.sessions-composer-toolbar\s*\{[^}]*flex-direction:\s*column;/s);
    expect(sessions).not.toMatch(
      /\.sessions-composer-actions\s*\{[^}]*overflow(?:-x|-y)?\s*:\s*(?:auto|scroll|hidden)/s,
    );
  });

  it("reveals a project folder tooltip when its selectable row has keyboard focus", () => {
    const projects = sheets.find((sheet) => sheet.name === "projects.css")?.styles ?? "";

    expect(projects).toMatch(
      /:root\[data-sovereign-input-modality="keyboard"\]\s+\.projects-list\s*>\s*li\s*>\s*\[role="group"\]:has\(>\s*button:focus\)\s+\.projects-row-folder\s+\[role="tooltip"\]\s*\{[^}]*display:\s*block;[^}]*opacity:\s*1;/s,
    );
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
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).toMatch(/\.sessions\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(sessions).toMatch(
      /\.sessions-chat\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/s,
    );
    expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(sessions).toMatch(/\.sessions-chat-scroll\s*\{[^}]*min-height:\s*0;/s);
    expect(sessions).not.toMatch(
      /\.sessions-chat[^}]*(?:position:\s*(?:sticky|absolute)|100vh|100dvh)/s,
    );
    expect(shell).toMatch(/\.shell-body\s*\{[^}]*overflow:\s*auto;/s);
    expect(shell).toMatch(/\.shell-page\s*\{[^}]*overflow:\s*hidden;/s);
    expect(shell).toMatch(
      /\.shell-page\[data-content-mode="contained"\]\s+\.shell-body\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(sessions).not.toMatch(/\.sessions-split/);
    expect(sessions).not.toMatch(/@media\s*\(width\s*<\s*60rem\)/);
  });

  it("keeps the session bottom zone measurable and the management form shrinkable", () => {
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).toMatch(
      /\.sessions-chat-bottom\s*\{[^}]*min-height:\s*0;[^}]*min-width:\s*0;/s,
    );
    expect(sessions).toMatch(
      /\.sessions-composer-surface\s*\{[^}]*align-self:\s*center;[^}]*width:\s*min\(calc\(100%\s*-\s*2\s*\*\s*var\(--sovereign-space-3\)\),\s*var\(--sovereign-reading-width\)\);[^}]*min-width:\s*0;/s,
    );
    expect(sessions).toMatch(/\.new-session-composer\s*\{[^}]*min-width:\s*0;/s);
  });

  it("centres the new-session start screen at reader width with safe fallbacks", () => {
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).toMatch(
      /\.new-session\s*\{[^}]*flex:\s*1 1 auto;[^}]*width:\s*min\(100%,\s*var\(--sovereign-reading-width\)\);[^}]*margin:\s*auto;/s,
    );
    expect(sessions).toMatch(
      /\.new-session\s*\{[^}]*justify-content:\s*center;[^}]*container-type:\s*inline-size;/s,
    );
    expect(sessions).toMatch(
      /\.new-session-project-agent\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    );
    expect(sessions).toMatch(
      /@container\s*\(width\s*<\s*32rem\)\s*\{[^}]*\.new-session-project-agent\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(sessions).toMatch(
      /@media\s*\(height\s*<\s*42rem\)\s*\{[^}]*\.new-session\s*\{[^}]*margin-block:\s*0\s+auto;/s,
    );
  });

  it("keeps usage inside the composer instead of restoring a full-width register", () => {
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).toMatch(/\.sessions-usage-tooltip\s*\{[^}]*display:\s*grid;/s);
    expect(sessions).toMatch(
      /\.sessions-usage-tooltip\s*>\s*hr\s*\{[^}]*border-block-start:\s*var\(--sovereign-stroke-thin\)\s+solid\s+currentColor;/s,
    );
    expect(sessions).not.toMatch(/\.sessions-usage(?:-context|-stat)?\s*\{/s);
  });

  it("keeps the central page in a permanent header and body grid", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";

    expect(shell).toMatch(
      /\.shell-page\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/s,
    );
    expect(shell).toMatch(
      /\.shell-header,\s*\.shell-body,\s*\.shell-header\s*>\s*\*\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;/s,
    );
    expect(shell).toMatch(/\.shell-page\s*\{[^}]*overflow:\s*hidden;/s);
    expect(shell).toMatch(/\.shell-body\s*\{[^}]*overflow:\s*auto;/s);
    expect(shell).not.toMatch(/\.shell-header[^}]*position:\s*(?:sticky|absolute)/s);
    expect(shell).not.toMatch(/\.shell-header[^}]*(?:100vh|100dvh)/s);
    expect(shell).toMatch(
      /\.shell-page\[data-content-mode="contained"\]\s+\.shell-body\s*\{[^}]*overflow:\s*hidden;/s,
    );
  });

  it("keeps one full-width content frame without imposing a reading width", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";

    expect(shell).toMatch(/\.shell-content-frame\s*\{[^}]*display:\s*flex;/s);
    expect(shell).toMatch(/\.shell-content-frame\s*\{[^}]*width:\s*100%;/s);
    expect(shell).toMatch(/\.shell-content-frame\s*\{[^}]*margin-inline:\s*auto;/s);
    expect(shell).toMatch(/\.shell-content-frame\s*\{[^}]*min-width:\s*0;/s);
    expect(shell).toMatch(/\.shell-content-frame\s*\{[^}]*min-height:\s*0;/s);
    expect(shell).not.toMatch(/\.shell-content-frame\s*\{[^}]*max-width\s*:/s);
  });

  it("lets the contained content frame fill the body without owning a second scroll", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";

    expect(shell).toMatch(
      /\.shell-page\[data-content-mode="contained"\]\s+\.shell-content-frame\s*\{[^}]*flex:\s*1 1 auto;/s,
    );
    expect(shell).not.toMatch(
      /\.shell-page\[data-content-mode="contained"\]\s+\.shell-content-frame\s*\{[^}]*overflow(?:-x|-y)?\s*:/s,
    );
  });

  it("makes the contained route child fill its bounded content frame", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";

    expect(shell).toMatch(
      /\.shell-page\[data-content-mode="contained"\]\s+\.shell-content-frame\s*>\s*:first-child\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/s,
    );
  });

  it("keeps clean-slate shell ownership free of dead plugin and historical selectors", () => {
    const shell = sheets.find((sheet) => sheet.name === "shell.css")?.styles ?? "";

    expect(shell).not.toMatch(
      /(?:^|[,{])\s*\.shell-(?:status|account-status|nav|projects)\s*(?:[,{]|\{)/m,
    );
    expect(shell).not.toMatch(/\.plugins(?:-plugin|-contribution|-contributions|-reasons)?\b/);
  });

  it("does not retain a composer option collapse container", () => {
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).not.toMatch(/sessions-composer-options/);
  });

  it("opens the chat and leaves composer elevation to UI Kit", () => {
    const sessions = sheets.find((sheet) => sheet.name === "sessions.css")?.styles ?? "";

    expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*background:\s*transparent;/s);
    expect(sessions).toMatch(/\.sessions-chat\s*\{[^}]*border:\s*none;/s);
    expect(sessions).not.toMatch(
      /\.sessions-composer(?:-surface)?\s*\{[^}]*(?:background|border(?:-radius)?|box-shadow)\s*:/s,
    );
  });

  it("leaves the shared settings scroll and split geometry to UI Kit", () => {
    const settings = sheets.find((sheet) => sheet.name === "settings.css")?.styles ?? "";

    expect(settings).not.toMatch(/\.settings-content-body/);
    expect(settings).not.toMatch(/\.settings-split/);
  });

  it("keeps settings content free of application-owned visual frames", () => {
    const settings = sheets.find((sheet) => sheet.name === "settings.css")?.styles ?? "";

    expect(settings).not.toMatch(/\.settings-(?:appearance|daemon)\s*>\s*\*\s*\+\s*\*/s);
    expect(settings).not.toMatch(
      /\.settings[^{]*\{[^}]*(?:box-shadow:\s*var\(--sovereign-elevation-|border-radius:\s*var\(--sovereign-radius-(?:sm|md|lg|xl))/s,
    );
  });

  it("leaves plugin list and detail row geometry to the UI kit", () => {
    const settings = sheets.find((sheet) => sheet.name === "settings.css")?.styles ?? "";

    expect(settings).not.toMatch(/\.plugins-row\s*\{/s);
    expect(settings).not.toMatch(/\.plugins-row-controls\s*\{/s);
    expect(settings).not.toMatch(/\.plugin-detail-(?:surface|hero|facts)\s*\{/s);
    expect(settings).toMatch(/\.plugin-detail-rows[\s,]*\.plugin-detail-contributions\s*\{/s);
    expect(settings).toMatch(/\.plugin-detail-contribution-controls\s*\{[^}]*min-width:\s*0;/s);
  });

  it("keeps only fallback plugin metadata grouping in application CSS", () => {
    const settings = sheets.find((sheet) => sheet.name === "settings.css")?.styles ?? "";

    expect(settings).not.toMatch(/\.plugins-list\s*>\s*\[role="listitem"\]\s*\{/s);
    expect(settings).toMatch(
      /\.plugins-row-meta\s*\{[^}]*font-size:\s*var\(--sovereign-font-size-xs\);/s,
    );
  });
});
