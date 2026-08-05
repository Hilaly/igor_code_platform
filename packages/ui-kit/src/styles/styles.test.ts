import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { roleNames, rolePropertyName } from "../tokens/roles.ts";

/**
 * Линтер следит за цветовыми литералами в коде, но не в CSS (eslint.config.js). Здесь та же проверка
 * для всех стилей кита: цвет мимо токена не переключается ни при смене варианта, ни при смене схемы,
 * и находится он на чужой схеме, а не у нас (docs/ui-kit.md).
 *
 * Обход директории, а не чтение одного файла: стили компонентов живут рядом с компонентами файлами
 * `*.module.css` (docs/roadmap.md, срез 5).
 */

const kitRoot = join(import.meta.dirname, "..");

function stylesheets(): { path: string; source: string }[] {
  const collected: { path: string; source: string }[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".css")) {
        collected.push({ path, source: readFileSync(path, "utf8") });
      }
    }
  };

  walk(kitRoot);

  return collected;
}

/** Комментарии выбрасываются до проверки: русское слово в пояснении не обязано обходить регэкспы. */
const withoutComments = (source: string): string => source.replaceAll(/\/\*[\s\S]*?\*\//g, "");

const declaredNames = (source: string): string[] =>
  [...source.matchAll(/(--sovereign-[a-z0-9-]+)\s*:/g)].map(([, name]) => name ?? "");

const usedNames = (source: string): string[] =>
  [...source.matchAll(/var\(\s*(--sovereign-[a-z0-9-]+)/g)].map(([, name]) => name ?? "");

const files = stylesheets();
const roleProperties = new Set(roleNames.map(rolePropertyName));

describe("stylesheets of the kit", () => {
  it("ships the approved voice, interface, and machine fonts locally", () => {
    const entry = readFileSync(join(kitRoot, "styles", "index.css"), "utf8");
    const tokens = readFileSync(join(kitRoot, "styles", "tokens.css"), "utf8");
    const manifest = JSON.parse(readFileSync(join(kitRoot, "..", "package.json"), "utf8"));
    const codeCss = readFileSync(join(kitRoot, "components", "code.module.css"), "utf8");
    const sliderCss = readFileSync(join(kitRoot, "components", "slider.module.css"), "utf8");

    expect(entry).toContain("@fontsource-variable/source-serif-4/wght.css");
    expect(entry).toContain("@fontsource-variable/manrope/wght.css");
    expect(entry).toContain("@fontsource/ibm-plex-mono/400.css");
    expect(entry).toContain("@fontsource/ibm-plex-mono/500.css");
    expect(tokens).toContain('"Source Serif 4 Variable"');
    expect(tokens).toContain('"Manrope Variable"');
    expect(tokens).toContain('"IBM Plex Mono"');
    expect(manifest.dependencies).toMatchObject({
      "@fontsource-variable/source-serif-4": expect.any(String),
      "@fontsource-variable/manrope": expect.any(String),
      "@fontsource/ibm-plex-mono": expect.any(String),
    });
    expect(codeCss.match(/font-weight: 400;/g)).toHaveLength(2);
    expect(sliderCss).toContain("font-weight: 500;");
  });

  it("uses Imperium as the catalogue fallback", () => {
    const catalogue = readFileSync(join(kitRoot, "..", ".ladle", "components.tsx"), "utf8");

    expect(catalogue).toContain("imperiumScheme");
    expect(catalogue).not.toContain("baseScheme");
  });

  it("defines contextual density and no decorative effect tokens", () => {
    const tokens = readFileSync(join(kitRoot, "styles", "tokens.css"), "utf8");
    const effects = readFileSync(join(kitRoot, "styles", "effects.css"), "utf8");

    expect(tokens).toContain("--sovereign-row-height-compact:");
    expect(tokens).toContain("--sovereign-reading-width:");
    expect(tokens).toContain("--sovereign-line-height-reading:");
    expect(effects).not.toMatch(/gradient|glow|glass|backdrop-blur|hairline/);
    expect(effects.match(/--sovereign-elevation-/g)).toHaveLength(3);
  });

  it("describes public accents and elevation without obsolete decorative effects", () => {
    const catalogue = readFileSync(join(kitRoot, "components", "ported.stories.tsx"), "utf8");
    const palette = readFileSync(join(kitRoot, "tokens", "palette.ts"), "utf8");
    const roles = readFileSync(join(kitRoot, "tokens", "roles.ts"), "utf8");
    const publicContract = readFileSync(
      join(kitRoot, "..", "..", "..", "docs", "public-contract.md"),
      "utf8",
    );
    const publicGuidance = [catalogue, palette, roles, publicContract].join("\n");

    expect(publicGuidance).not.toMatch(/gradient|hairline|glass|градиент|волосян|стекл/i);
    expect(catalogue).toMatch(/семантическ(?:ий|ого) акцент/i);
    expect(palette).toMatch(/смыслов(?:ая|ые|ых) (?:метка|метки|меток)/i);
    expect(roles).toMatch(/нажат(?:ое|ого) состояни/i);
    expect(publicContract).toMatch(/сдержанн(?:ая|ой) тень/i);
  });

  it("keeps shared primitive geometry compact without shrinking row hit areas", () => {
    const buttonCss = readFileSync(join(kitRoot, "components", "button.module.css"), "utf8");
    const inputCss = readFileSync(join(kitRoot, "components", "input.module.css"), "utf8");
    const listCss = readFileSync(join(kitRoot, "components", "list.module.css"), "utf8");
    const panelCss = readFileSync(join(kitRoot, "components", "panel.module.css"), "utf8");
    const textCss = readFileSync(join(kitRoot, "components", "text.module.css"), "utf8");
    const treeCss = readFileSync(join(kitRoot, "components", "tree.module.css"), "utf8");

    expect(buttonCss).toContain("height: var(--sovereign-row-height-compact)");
    expect(buttonCss).toContain("border-radius: var(--sovereign-radius-sm)");
    expect(buttonCss).toContain("inset-block: calc(var(--sovereign-space-1) * -1)");
    expect(inputCss).toContain("height: var(--sovereign-control-height-sm)");
    expect(inputCss).toContain("min-height: 1.75rem");
    expect(inputCss).toContain("border-radius: var(--sovereign-radius-sm)");
    expect(listCss).toContain("height: var(--sovereign-row-height-compact)");
    expect(listCss).toContain("width: 100%");
    expect(listCss).toContain("padding-inline: var(--sovereign-space-3)");
    expect(listCss).toContain("padding-block: var(--sovereign-space-1)");
    expect(listCss).toContain("box-sizing: content-box");
    expect(listCss).toContain(".select:has(> *)");
    expect(treeCss).toContain("min-height: var(--sovereign-row-height-compact)");
    expect(treeCss).not.toContain("width: 100%");
    expect(treeCss).toContain("padding-inline: var(--sovereign-space-2)");
    expect(treeCss).toContain("padding-block: var(--sovereign-space-1)");
    expect(treeCss).toContain("box-sizing: content-box");
    expect(textCss).toContain("font-family: var(--sovereign-font-family-display)");
    expect(panelCss).toContain("border-radius: var(--sovereign-radius-sm)");
    expect(panelCss).toContain("background: var(--sovereign-panel-surface)");
    expect(panelCss).toContain("box-shadow: var(--sovereign-elevation-1)");
    expect(panelCss).not.toMatch(/backdrop-filter|gradient|glass/);
  });

  it("lets ViewHeader actions wrap inside a constrained container", () => {
    const viewHeaderCss = readFileSync(
      join(kitRoot, "components", "view-header.module.css"),
      "utf8",
    );

    expect(viewHeaderCss).toMatch(
      /\.actions\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s,
    );
    expect(viewHeaderCss).toMatch(/\.actions\s*\{[^}]*justify-content:\s*flex-end;/s);
  });

  it("keeps shared application states flat and elevates only overlays", () => {
    const dialogCss = withoutComments(
      readFileSync(join(kitRoot, "components", "dialog.module.css"), "utf8"),
    );
    const noticeCss = withoutComments(
      readFileSync(join(kitRoot, "components", "notice.module.css"), "utf8"),
    );
    const stateCss = withoutComments(
      readFileSync(join(kitRoot, "components", "state.module.css"), "utf8"),
    );
    const toastCss = withoutComments(
      readFileSync(join(kitRoot, "components", "toast.module.css"), "utf8"),
    );
    const sharedStates = [dialogCss, noticeCss, stateCss, toastCss].join("\n");

    expect(sharedStates).not.toMatch(/gradient|backdrop-filter|\bfilter\s*:/);
    expect(dialogCss).toMatch(
      /\.surface\s*\{[^}]*border:\s*var\(--sovereign-stroke-thin\)\s+solid\s+var\(--sovereign-border-strong\);/s,
    );
    expect(dialogCss).toMatch(
      /\.surface\s*\{[^}]*background:\s*var\(--sovereign-panel-surface\);[^}]*box-shadow:\s*var\(--sovereign-elevation-3\);/s,
    );
    expect(dialogCss).toMatch(/\.modal\s*\{[^}]*border-radius:\s*var\(--sovereign-radius-md\);/s);
    expect(noticeCss).toMatch(/\.notice\s*\{[^}]*border-radius:\s*var\(--sovereign-radius-sm\);/s);
    expect(noticeCss).not.toMatch(/box-shadow/);
    expect(stateCss).toMatch(/\.empty\s*\{(?![^}]*(?:background|border|box-shadow)\s*:)[^}]*\}/s);
    expect(toastCss).toMatch(
      /\.toast\s*\{[^}]*background:\s*var\(--sovereign-panel-surface\);[^}]*border:\s*var\(--sovereign-stroke-thin\)\s+solid\s+var\(--sovereign-border-strong\);[^}]*border-radius:\s*var\(--sovereign-radius-sm\);[^}]*box-shadow:\s*var\(--sovereign-elevation-2\);/s,
    );
    expect(toastCss).toMatch(
      /\.normal\s*\{[^}]*border-color:\s*var\(--sovereign-accent-border\);/s,
    );
    expect(toastCss).toMatch(
      /\.success\s*\{[^}]*border-color:\s*var\(--sovereign-success-border\);/s,
    );
    expect(toastCss).toMatch(
      /\.warning\s*\{[^}]*border-color:\s*var\(--sovereign-warning-border\);/s,
    );
    expect(toastCss).toMatch(
      /\.danger\s*\{[^}]*border-color:\s*var\(--sovereign-danger-border\);/s,
    );
    expect(noticeCss + stateCss).not.toMatch(/--sovereign-elevation-/);
  });

  it("catalogues the canonical shared system states on the page surface", () => {
    const catalogue = readFileSync(join(kitRoot, "components", "primitives.stories.tsx"), "utf8");
    const systemStates = catalogue.slice(catalogue.indexOf("export const SystemStates"));

    expect(catalogue).toContain('background: "var(--sovereign-page-surface)"');
    expect(systemStates).toContain("style={statePage}");
    expect(systemStates).toMatch(/<Spinner\b/);
    expect(systemStates).toMatch(/<EmptyState\b/);
    expect(systemStates).toMatch(/<Notice\s+tone="danger"/);
    expect(systemStates).toMatch(/<ConfirmDialog\b/);
    expect(systemStates).toMatch(/toast\(\{/);
  });

  it("assigns editorial, human, and machine typography by message context", () => {
    const feedCss = readFileSync(join(kitRoot, "components", "message-feed.module.css"), "utf8");
    const markdownCss = readFileSync(join(kitRoot, "components", "markdown.module.css"), "utf8");
    const streamingCss = readFileSync(
      join(kitRoot, "components", "streaming-text.module.css"),
      "utf8",
    );

    expect(feedCss).toMatch(/\[data-role="agent"\][\s\S]*--sovereign-font-family-display/);
    expect(feedCss).toMatch(/\[data-role="human"\][\s\S]*--sovereign-font-family-body/);
    expect(feedCss).toContain("max-width: var(--sovereign-reading-width)");
    expect(feedCss).toContain("margin-inline: auto");
    expect(feedCss).not.toMatch(/\.message\[data-role="service"\]\s*\{[^}]*max-width:\s*100%/);
    expect(markdownCss).toContain("font-family: inherit");
    expect(streamingCss).toContain("font-family: var(--sovereign-font-family-display)");
  });

  it("keeps disclosure controls sans and long tool summaries predictable", () => {
    const badgeCss = readFileSync(join(kitRoot, "components", "badge.module.css"), "utf8");
    const disclosureCss = readFileSync(
      join(kitRoot, "components", "disclosure.module.css"),
      "utf8",
    );
    const toolCallCss = readFileSync(join(kitRoot, "components", "tool-call.module.css"), "utf8");

    expect(disclosureCss).toMatch(
      /\.summary\s*\{[^}]*font-family:\s*var\(--sovereign-font-family-body\);/s,
    );
    expect(badgeCss).toMatch(
      /\.badge\s*\{[^}]*font-family:\s*var\(--sovereign-font-family-body\);/s,
    );
    expect(toolCallCss).toMatch(/\.identity\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(toolCallCss).toMatch(
      /\.description\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(toolCallCss).toMatch(
      /\.outputLabel\s*\{[^}]*font-family:\s*var\(--sovereign-font-family-body\);/s,
    );
  });

  it("ships at least one stylesheet per component and the shared layer", () => {
    expect(files.length).toBeGreaterThan(1);
  });

  it("takes every colour from a role variable", () => {
    for (const { path, source } of files) {
      const body = withoutComments(source);
      const literals = [
        ...(body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
        ...(body.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) ?? []),
        // Именованные цвета — тот же литерал: он не переключится вместе со схемой. `transparent` и
        // `currentColor` — не цвета, а указания, и потому разрешены.
        //
        // Дефис по краям исключён намеренно: имя цвета встречается внутри имён свойств
        // (`white-space`, `border-block`), и совпадение по одному `\b` объявляло бы цветовым
        // литералом обычное свойство — с сообщением, по которому этого не понять.
        ...(body.match(
          /(?<![-\w])(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|brown|cyan|magenta|teal|navy|olive|maroon|lime|aqua|fuchsia)(?![-\w])/gi,
        ) ?? []),
      ];

      expect(literals, path).toEqual([]);
    }
  });

  it("names only roles the kit derives and tokens it declares itself", () => {
    const declared = new Set(files.flatMap(({ source }) => declaredNames(withoutComments(source))));

    for (const { path, source } of files) {
      const unknown = usedNames(withoutComments(source)).filter(
        (name) => !roleProperties.has(name) && !declared.has(name),
      );

      expect([...new Set(unknown)], path).toEqual([]);
    }
  });

  /**
   * Токен без потребителя врёт про то, что визуальная система его различает: пять уровней
   * возвышения, из которых применяются два, — это не система, а список пожеланий.
   *
   * Потребитель за пределами кита объявляется здесь явно. Кит публичный, и когда браузерный код
   * плагина начнёт приносить свой CSS (docs/ui-extension-model.md), таких записей станет больше —
   * но каждая обязана быть названа, иначе правило перестаёт что-либо проверять.
   */
  it("declares no token without a consumer", () => {
    const usedOutsideTheKit = new Set<string>();
    const used = new Set(files.flatMap(({ source }) => usedNames(withoutComments(source))));
    const dead = [
      ...new Set(files.flatMap(({ source }) => declaredNames(withoutComments(source)))),
    ].filter(
      (name) => !used.has(name) && !roleProperties.has(name) && !usedOutsideTheKit.has(name),
    );

    expect(dead).toEqual([]);
  });

  it("gives every elevated surface a semantic surface and appropriate elevation", () => {
    const elevatedSurfaces = new Map([
      ["components/dialog.module.css", "--sovereign-elevation-3"],
      ["components/menu.module.css", "--sovereign-elevation-2"],
      ["components/panel.module.css", "--sovereign-elevation-1"],
      ["components/popover.module.css", "--sovereign-elevation-2"],
      ["components/raised-surface.module.css", "--sovereign-elevation-1"],
      ["components/toast.module.css", "--sovereign-elevation-2"],
    ]);

    for (const [relativePath, elevation] of elevatedSurfaces) {
      const source = readFileSync(join(kitRoot, relativePath), "utf8");

      expect(usedNames(withoutComments(source)), relativePath).toEqual(
        expect.arrayContaining(["--sovereign-panel-surface", elevation]),
      );
    }
  });

  it("owns the compact raised-surface visual contract", () => {
    const source = withoutComments(
      readFileSync(join(kitRoot, "components", "raised-surface.module.css"), "utf8"),
    );

    expect(source).toMatch(/\.surface\s*\{[^}]*padding:\s*var\(--sovereign-space-3\);/s);
    expect(source).toMatch(
      /\.surface\s*\{[^}]*border:\s*var\(--sovereign-stroke-thin\)\s+solid\s+var\(--sovereign-border-strong\);/s,
    );
    expect(source).toMatch(/\.surface\s*\{[^}]*border-radius:\s*var\(--sovereign-radius-md\);/s);
    expect(source).toMatch(/\.surface\s*\{[^}]*background:\s*var\(--sovereign-panel-surface\);/s);
    expect(source).toMatch(/\.surface\s*\{[^}]*box-shadow:\s*var\(--sovereign-elevation-1\);/s);
  });

  it("dresses every primitive it ships", () => {
    const components = readdirSync(join(kitRoot, "components"))
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) => !name.endsWith(".test.tsx") && !name.endsWith(".stories.tsx"));

    expect(components.length).toBeGreaterThan(0);

    for (const name of components) {
      const source = readFileSync(join(kitRoot, "components", name), "utf8");

      expect(source, name).toMatch(/import styles from "\.\/[a-z-]+\.module\.css";/);
    }
  });
});
