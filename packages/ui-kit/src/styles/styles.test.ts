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
      ["components/panel.module.css", "--sovereign-elevation-2"],
      ["components/popover.module.css", "--sovereign-elevation-2"],
    ]);

    for (const [relativePath, elevation] of elevatedSurfaces) {
      const source = readFileSync(join(kitRoot, relativePath), "utf8");

      expect(usedNames(withoutComments(source)), relativePath).toEqual(
        expect.arrayContaining(["--sovereign-panel-surface", elevation]),
      );
    }
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
