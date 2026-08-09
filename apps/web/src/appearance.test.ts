import {
  builtInColorScheme,
  interfaceScales,
  type AppearancePreferences,
  type ContributionRegistration,
} from "@sovereign/protocol";
import {
  coreEnglish,
  coreNamespace,
  coreRussian,
  createTranslator,
  imperiumScheme,
  oledScheme,
  rolePropertyName,
  scaleAttributeName,
  tokenContractMajor,
  type CatalogRegistration,
  type ColorScheme,
} from "@sovereign/ui-kit";
import { describe, expect, it } from "vitest";

import {
  applyAppearance,
  cacheAppearance,
  defaultAppearancePreferences,
  describeSchemes,
  pluginColorSchemes,
  readCachedAppearance,
  resolveVariant,
  shippedSchemes,
  type PreferencesCache,
} from "./appearance.ts";

function cache(initial?: string): PreferencesCache {
  let value = initial;

  return {
    getItem: () => value ?? null,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

function applied(
  preferences: AppearancePreferences,
  prefersDark = false,
  schemes?: readonly ColorScheme[],
) {
  const written = new Map<string, string>();
  const attributes = new Map<string, string>();
  const diagnostics: string[] = [];

  applyAppearance({
    preferences,
    prefersDark,
    ...(schemes === undefined ? {} : { schemes }),
    target: { setProperty: (property, value) => void written.set(property, value) },
    root: { setAttribute: (name, value) => void attributes.set(name, value) },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return { written, attributes, diagnostics };
}

// Палитра берётся у схемы поставки, а не пишется литералами: цвет в этих файлах запрещён линтером
// (docs/ui-kit.md), а для проверки важно лишь то, что она не совпадает со встроенной.
const midnightPalette: Record<string, string> = oledScheme.variants.dark;

const colorScheme = (
  declaredId: string,
  scheme: {
    tokenContract: number;
    variants: Record<string, Record<string, string>>;
    roleOverrides?: Record<string, string>;
  },
  title?: string,
): ContributionRegistration => ({
  ownership: "plugin",
  kind: "color-scheme",
  id: `themed.${declaredId}`,
  declaredId,
  pluginKey: "data:themed",
  pluginId: "themed",
  source: "data",
  ...(title === undefined ? {} : { title }),
  scheme,
});

const midnight = colorScheme("midnight", {
  tokenContract: tokenContractMajor,
  variants: { light: midnightPalette, dark: midnightPalette },
});

describe("resolveVariant", () => {
  it("takes the system variant from what the system asks for", () => {
    expect(resolveVariant("system", true)).toBe("dark");
    expect(resolveVariant("system", false)).toBe("light");
  });

  it("leaves a named variant alone", () => {
    expect(resolveVariant("light", true)).toBe("light");
    expect(resolveVariant("dark", false)).toBe("dark");
  });
});

describe("applyAppearance", () => {
  it("writes the palette of the chosen variant", () => {
    const { written, diagnostics } = applied({
      appearance: { colorScheme: builtInColorScheme, variant: "dark", scale: "default" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(imperiumScheme.variants.dark.surface);
    expect(diagnostics).toEqual([]);
  });

  it("follows the system when the variant says so", () => {
    const { written } = applied(defaultAppearancePreferences, true);

    expect(written.get(rolePropertyName("pageSurface"))).toBe(imperiumScheme.variants.dark.surface);
  });

  it("falls back to the built-in scheme and says the named one is gone", () => {
    const { written, diagnostics } = applied({
      appearance: { colorScheme: "midnight", variant: "light", scale: "default" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(
      imperiumScheme.variants.light.surface,
    );
    expect(diagnostics.join("\n")).toMatch(/no colour scheme midnight/);
  });

  it("falls back to Imperium when a removed scheme is requested", () => {
    const { written } = applied({
      appearance: { colorScheme: "check", variant: "light", scale: "default" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(
      imperiumScheme.variants.light.surface,
    );
  });

  it("puts the chosen scale on the root as an attribute", () => {
    for (const scale of interfaceScales) {
      const { attributes } = applied({
        appearance: { colorScheme: builtInColorScheme, variant: "light", scale },
        locale: "en",
      });

      expect(attributes.get(scaleAttributeName)).toBe(scale);
    }
  });

  it("applies the scale even when the named scheme is gone: the size does not hang on the colours", () => {
    const { attributes } = applied({
      appearance: { colorScheme: "midnight", variant: "light", scale: "larger" },
      locale: "en",
    });

    expect(attributes.get(scaleAttributeName)).toBe("larger");
  });

  it.each(["light", "dark"] as const)(
    "contains a malformed plugin %s palette and applies Imperium with the requested scale",
    (variant) => {
      const malformed: ColorScheme = {
        ...oledScheme,
        id: "themed.broken",
        variants: {
          ...oledScheme.variants,
          [variant]: { ...oledScheme.variants[variant], surface: "" },
        },
      };
      const preferences: AppearancePreferences = {
        appearance: { colorScheme: malformed.id, variant, scale: "larger" },
        locale: "en",
      };

      expect(() => applied(preferences, false, [...shippedSchemes, malformed])).not.toThrow();
      const { written, attributes, diagnostics } = applied(preferences, false, [
        ...shippedSchemes,
        malformed,
      ]);

      expect(written.get(rolePropertyName("pageSurface"))).toBe(
        imperiumScheme.variants[variant].surface,
      );
      expect(attributes.get(scaleAttributeName)).toBe("larger");
      expect(diagnostics.join("\n")).toMatch(new RegExp(`${variant} palette.*surface`));
    },
  );
});

describe("colour schemes brought by plugins", () => {
  const diagnosed = (contributions: ContributionRegistration[]) => {
    const { schemes, refusals } = pluginColorSchemes(contributions);

    return { schemes, diagnostics: refusals };
  };

  it("parses a declared scheme and names it by the contribution identifier", () => {
    const { schemes, diagnostics } = diagnosed([midnight]);

    expect(schemes.map((scheme) => scheme.id)).toEqual(["themed.midnight"]);
    expect(diagnostics).toEqual([]);
  });

  it("keeps a scheme with an incomplete palette out of the list and says why", () => {
    const incomplete = Object.fromEntries(
      Object.entries(midnightPalette).filter(([key]) => key !== "surface"),
    );
    const { schemes, diagnostics } = diagnosed([
      midnight,
      colorScheme("sparse", {
        tokenContract: tokenContractMajor,
        variants: { light: incomplete, dark: midnightPalette },
      }),
    ]);

    // Выбрать её нельзя, потому что применить её нечем: неполная палитра дала бы сломанный CSS.
    expect(schemes.map((scheme) => scheme.id)).toEqual(["themed.midnight"]);
    expect(diagnostics.join("\n")).toMatch(/themed.sparse has no surface/);
  });

  it.each([
    ["light", "surface", ""],
    ["dark", "accent", "not-a-color"],
  ] as const)(
    "contains a daemon handoff with an invalid %s palette colour",
    (variant, role, value) => {
      const { schemes, diagnostics } = diagnosed([
        colorScheme("broken", {
          tokenContract: tokenContractMajor,
          variants: {
            light: midnightPalette,
            dark: midnightPalette,
            [variant]: { ...midnightPalette, [role]: value },
          },
        }),
      ]);
      const preferences: AppearancePreferences = {
        appearance: { colorScheme: "themed.broken", variant, scale: "smaller" },
        locale: "en",
      };
      const fallback = applied(preferences, false, [...shippedSchemes, ...schemes]);

      expect(schemes).toEqual([]);
      expect(diagnostics.join("\n")).toMatch(new RegExp(`${variant} palette.*${role}`));
      expect(fallback.written.get(rolePropertyName("pageSurface"))).toBe(
        imperiumScheme.variants[variant].surface,
      );
      expect(fallback.attributes.get(scaleAttributeName)).toBe("smaller");
      expect(fallback.diagnostics.join("\n")).toMatch(/no colour scheme themed\.broken/);
    },
  );

  it("keeps a scheme with an invalid known role override out of the list", () => {
    const { schemes, diagnostics } = diagnosed([
      colorScheme("broken", {
        tokenContract: tokenContractMajor,
        variants: { light: midnightPalette, dark: midnightPalette },
        roleOverrides: { accent: "not-a-color" },
      }),
    ]);

    expect(schemes).toEqual([]);
    expect(diagnostics.join("\n")).toMatch(/role accent/);
  });

  it("keeps a scheme written for another token contract out of the list and says why", () => {
    // Мажор чужой — значит схема не применится ни в одном варианте, и предлагать её нечестно:
    // выбор молча оставил бы человека на встроенной схеме.
    const { schemes, diagnostics } = diagnosed([
      midnight,
      colorScheme("ancient", {
        tokenContract: tokenContractMajor - 1,
        variants: { light: midnightPalette, dark: midnightPalette },
      }),
    ]);

    expect(schemes.map((scheme) => scheme.id)).toEqual(["themed.midnight"]);
    expect(diagnostics.join("\n")).toMatch(
      new RegExp(`themed.ancient declares token contract ${tokenContractMajor - 1}`),
    );
  });

  it("applies the scheme of a plugin and falls back to Imperium once the plugin is gone", () => {
    const preferences: AppearancePreferences = {
      appearance: { colorScheme: "themed.midnight", variant: "light", scale: "default" },
      locale: "en",
    };
    const { schemes } = diagnosed([midnight]);

    const withPlugin = applied(preferences, false, [...shippedSchemes, ...schemes]);
    const withoutPlugin = applied(preferences, false, shippedSchemes);

    expect(withPlugin.written.get(rolePropertyName("pageSurface"))).toBe(midnightPalette.surface);
    expect(withPlugin.diagnostics).toEqual([]);
    expect(withoutPlugin.written.get(rolePropertyName("pageSurface"))).toBe(
      imperiumScheme.variants.light.surface,
    );
    // Настройка при этом не переписывается: включённый обратно плагин обязан вернуть цвета.
    expect(preferences.appearance.colorScheme).toBe("themed.midnight");
    expect(withoutPlugin.diagnostics.join("\n")).toMatch(/no colour scheme themed.midnight/);
  });

  it("falls back to Imperium if a scheme with another token contract reaches applying anyway", () => {
    // Вторая половина той же защиты: в список такая схема не попадает, но проверка при применении
    // остаётся — она одна на схемы поставки и на чужие, и снимать её вслед за первой нельзя.
    const { written, diagnostics } = applied(
      {
        appearance: { colorScheme: "themed.ancient", variant: "light", scale: "default" },
        locale: "en",
      },
      false,
      [
        ...shippedSchemes,
        { ...oledScheme, id: "themed.ancient", tokenContract: tokenContractMajor + 1 },
      ],
    );

    expect(written.get(rolePropertyName("pageSurface"))).toBe(
      imperiumScheme.variants.light.surface,
    );
    expect(diagnostics.join("\n")).toMatch(/token contract/);
  });
});

describe("describeSchemes", () => {
  const translator = (extra: CatalogRegistration[] = []) =>
    createTranslator({
      locale: "en",
      namespace: coreNamespace,
      catalogs: [coreEnglish, coreRussian, ...extra],
      onDiagnostic: () => {},
    });

  it("calls a shipped scheme by our own catalog", () => {
    expect(describeSchemes([imperiumScheme], [], translator())).toEqual([
      { id: imperiumScheme.id, label: coreEnglish.messages[`appearance.scheme.imperium`] },
    ]);
  });

  it("prefers the catalog of the plugin in its own namespace", () => {
    const named = translator([
      {
        namespace: "themed",
        locale: "en",
        messages: { "appearance.scheme.midnight": "Полночь" },
      },
    ]);
    const [scheme] = pluginColorSchemes([midnight]).schemes;

    expect(describeSchemes([scheme!], [midnight], named)).toEqual([
      { id: "themed.midnight", label: "Полночь" },
    ]);
  });

  it("falls back to the title of the contribution, and then to its identifier", () => {
    const titled = colorScheme(
      "titled",
      {
        tokenContract: tokenContractMajor,
        variants: { light: midnightPalette, dark: midnightPalette },
      },
      "Midnight",
    );
    const contributions = [midnight, titled];
    const { schemes } = pluginColorSchemes(contributions);

    expect(describeSchemes(schemes, contributions, translator())).toEqual([
      { id: "themed.midnight", label: "themed.midnight" },
      { id: "themed.titled", label: "Midnight" },
    ]);
  });
});

describe("the appearance cache", () => {
  it("gives back what it kept, the scale included: it must survive a reload", () => {
    const kept = cache();
    const preferences: AppearancePreferences = {
      appearance: { colorScheme: "midnight", variant: "dark", scale: "smaller" },
      locale: "ru",
    };

    cacheAppearance(kept, preferences);

    expect(readCachedAppearance(kept)).toEqual(preferences);
  });

  it("says nothing when there is nothing or the entry is broken", () => {
    expect(readCachedAppearance(cache())).toBeUndefined();
    expect(readCachedAppearance(cache("{ half"))).toBeUndefined();
    expect(readCachedAppearance(cache(JSON.stringify({ locale: "ru" })))).toBeUndefined();
  });

  it("keeps an entry written before the scale existed and reads it as the ordinary scale", () => {
    const stored = JSON.stringify({
      appearance: { colorScheme: "midnight", variant: "dark" },
      locale: "ru",
    });

    expect(readCachedAppearance(cache(stored))).toEqual({
      appearance: { colorScheme: "midnight", variant: "dark", scale: "default" },
      locale: "ru",
    });
  });

  it("reads a scale it does not know as the ordinary one instead of dropping the entry", () => {
    const stored = JSON.stringify({
      appearance: { colorScheme: "midnight", variant: "dark", scale: "huge" },
      locale: "ru",
    });

    expect(readCachedAppearance(cache(stored))?.appearance.scale).toBe("default");
  });
});
