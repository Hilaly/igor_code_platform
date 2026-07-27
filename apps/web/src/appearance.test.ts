import { baseColorScheme, type AppearancePreferences } from "@sovereign/protocol";
import { baseScheme, checkScheme, rolePropertyName } from "@sovereign/ui-kit";
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
  const diagnostics: string[] = [];

  applyAppearance({
    preferences,
    prefersDark,
    target: { setProperty: (property, value) => void written.set(property, value) },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return { written, diagnostics };
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
      appearance: { colorScheme: baseColorScheme, variant: "dark" },
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
      appearance: { colorScheme: "midnight", variant: "light" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(baseScheme.variants.light.surface);
    expect(diagnostics.join("\n")).toMatch(/no colour scheme midnight/);
  });

  it("applies the check scheme when it is chosen: it is a shipped scheme like any other", () => {
    const { written } = applied({
      appearance: { colorScheme: checkScheme.id, variant: "light" },
      locale: "en",
    });

    expect(written.get(rolePropertyName("pageSurface"))).toBe(checkScheme.variants.light.surface);
  });
});

describe("the appearance cache", () => {
  it("gives back what it kept", () => {
    const kept = cache();
    const preferences: AppearancePreferences = {
      appearance: { colorScheme: "midnight", variant: "dark" },
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
});
