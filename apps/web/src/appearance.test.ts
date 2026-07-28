import { baseColorScheme, interfaceScales, type AppearancePreferences } from "@sovereign/protocol";
import { baseScheme, checkScheme, rolePropertyName, scaleAttributeName } from "@sovereign/ui-kit";
import { describe, expect, it } from "vitest";

import {
  applyAppearance,
  cacheAppearance,
  defaultAppearancePreferences,
  readCachedAppearance,
  resolveVariant,
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

function applied(preferences: AppearancePreferences, prefersDark = false) {
  const written = new Map<string, string>();
  const attributes = new Map<string, string>();
  const diagnostics: string[] = [];

  applyAppearance({
    preferences,
    prefersDark,
    target: { setProperty: (property, value) => void written.set(property, value) },
    root: { setAttribute: (name, value) => void attributes.set(name, value) },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return { written, attributes, diagnostics };
}

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
      appearance: { colorScheme: baseColorScheme, variant: "dark", scale: "default" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(baseScheme.variants.dark.surface);
    expect(diagnostics).toEqual([]);
  });

  it("follows the system when the variant says so", () => {
    const { written } = applied(defaultAppearancePreferences, true);

    expect(written.get(rolePropertyName("pageSurface"))).toBe(baseScheme.variants.dark.surface);
  });

  it("falls back to the built-in scheme and says the named one is gone", () => {
    const { written, diagnostics } = applied({
      appearance: { colorScheme: "midnight", variant: "light", scale: "default" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(baseScheme.variants.light.surface);
    expect(diagnostics.join("\n")).toMatch(/no colour scheme midnight/);
  });

  it("applies the check scheme when it is chosen: it is a shipped scheme like any other", () => {
    const { written } = applied({
      appearance: { colorScheme: checkScheme.id, variant: "light", scale: "default" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(checkScheme.variants.light.surface);
  });

  it("puts the chosen scale on the root as an attribute", () => {
    for (const scale of interfaceScales) {
      const { attributes } = applied({
        appearance: { colorScheme: baseColorScheme, variant: "light", scale },
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
