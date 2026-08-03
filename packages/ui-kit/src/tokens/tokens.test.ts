import { interfaceScales } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { applyRoles, applyScale, scaleAttributeName } from "./apply.ts";
import { paletteKeys, paletteVariants, type Palette } from "./palette.ts";
import { deriveRoles, roleNames, rolePropertyName } from "./roles.ts";
import { resolveScheme, tokenContractMajor, type ColorScheme } from "./scheme.ts";
import { imperiumScheme } from "./schemes/imperium.ts";
import { shippedSchemes } from "./schemes/shipped.ts";

describe("deriveRoles", () => {
  it("gives every role a value for both variants", () => {
    for (const scheme of shippedSchemes) {
      for (const variant of paletteVariants) {
        const roles = deriveRoles(scheme.variants[variant]);

        expect(Object.keys(roles).sort()).toEqual([...roleNames].sort());

        for (const [role, value] of Object.entries(roles)) {
          expect(value, `${scheme.id} ${variant} ${role}`).not.toBe("");
        }
      }
    }
  });

  it("names the palette in the derived value, so a scheme change reaches every state", () => {
    const roles = deriveRoles(imperiumScheme.variants.light);

    expect(roles.accentHover).toContain(imperiumScheme.variants.light.accent);
    expect(roles.accentHover).toContain(imperiumScheme.variants.light.ink);
  });
});

describe("imperiumScheme", () => {
  it("separates the Refined Imperium surfaces", () => {
    expect(imperiumScheme.variants.dark).toMatchObject({
      surface: "#14100b",
      surfaceRaised: "#201a13",
      surfaceSunken: "#100d09",
      border: "#3b2f21",
    });
    expect(imperiumScheme.variants.light).toMatchObject({
      surface: "#f3ead8",
      surfaceRaised: "#fffaf0",
      surfaceSunken: "#e7dcc5",
      border: "#d1bea0",
    });
  });
});

describe("rolePropertyName", () => {
  it("turns a role into a prefixed css variable", () => {
    expect(rolePropertyName("panelSurface")).toBe("--sovereign-panel-surface");
  });

  it("keeps the names distinct", () => {
    const names = new Set(roleNames.map(rolePropertyName));

    expect(names.size).toBe(roleNames.length);
  });
});

describe("resolveScheme", () => {
  it("refuses a scheme that speaks another token contract", () => {
    const outcome = resolveScheme(
      { ...imperiumScheme, tokenContract: tokenContractMajor + 1 },
      "light",
    );

    expect(outcome.kind).toBe("rejected");
    expect(outcome.diagnostics.join("\n")).toMatch(/token contract/);
  });

  it("applies a declared role override and says the scheme is now brittle", () => {
    const scheme: ColorScheme = { ...imperiumScheme, roleOverrides: { accent: "#123456" } };
    const outcome = resolveScheme(scheme, "light");

    expect(outcome.kind).toBe("resolved");
    expect(outcome.kind === "resolved" && outcome.roles.accent).toBe("#123456");
    expect(outcome.diagnostics.join("\n")).toMatch(/overrides the role accent/);
  });

  it("ignores an override of an unknown role instead of refusing the scheme", () => {
    const scheme = {
      ...imperiumScheme,
      roleOverrides: { neonEdge: "#123456" },
    } as unknown as ColorScheme;
    const outcome = resolveScheme(scheme, "light");

    expect(outcome.kind).toBe("resolved");
    expect(outcome.diagnostics.join("\n")).toMatch(/unknown role neonEdge/);
  });

  it("leaves the roles it was not told to override derived from the palette", () => {
    const scheme: ColorScheme = { ...imperiumScheme, roleOverrides: { accent: "#123456" } };
    const outcome = resolveScheme(scheme, "dark");

    expect(outcome.kind === "resolved" && outcome.roles.text).toBe(
      imperiumScheme.variants.dark.ink,
    );
  });
});

describe("applyRoles", () => {
  it("writes every role as a css variable", () => {
    const written = new Map<string, string>();
    const roles = deriveRoles(imperiumScheme.variants.dark);

    applyRoles(roles, { setProperty: (property, value) => void written.set(property, value) });

    expect(written.size).toBe(roleNames.length);
    expect(written.get("--sovereign-page-surface")).toBe(imperiumScheme.variants.dark.surface);
  });
});

describe("applyScale", () => {
  it("writes every step as the attribute the kit's css reacts to", () => {
    for (const scale of interfaceScales) {
      const written = new Map<string, string>();

      applyScale(scale, { setAttribute: (name, value) => void written.set(name, value) });

      expect(written.get(scaleAttributeName)).toBe(scale);
    }
  });

  it("names the ordinary scale instead of dropping the attribute", () => {
    const written = new Map<string, string>();

    applyScale("default", { setAttribute: (name, value) => void written.set(name, value) });

    expect(written.get(scaleAttributeName)).toBe("default");
  });
});

/**
 * Вывод ролей — наша ответственность, значит читаемость обязана сохраняться при любой палитре
 * (docs/ui-kit.md). Порог один на все текстовые пары: 4.5 к 1, как для основного текста в WCAG. Границы и
 * разделители здесь не проверяются — это не текст, и судить их приходится глазом.
 */
describe("contrast", () => {
  const textPairs = [
    ["ink", "surface"],
    ["ink", "surfaceRaised"],
    ["ink", "surfaceSunken"],
    ["inkMuted", "surface"],
    ["inkMuted", "surfaceRaised"],
    ["accentInk", "accent"],
    ["dangerInk", "danger"],
    ["danger", "surface"],
    ["warning", "surface"],
    ["success", "surface"],
  ] as const satisfies readonly (readonly [keyof Palette, keyof Palette])[];

  it("keeps text legible in every shipped scheme", () => {
    for (const scheme of shippedSchemes) {
      for (const variant of paletteVariants) {
        const palette = scheme.variants[variant];

        for (const [text, background] of textPairs) {
          const ratio = contrastRatio(palette[text], palette[background]);

          expect(
            ratio,
            `${scheme.id} ${variant}: ${text} on ${background} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("covers the whole palette between the pairs and what is not text", () => {
    // Второй акцент здесь не проверяется намеренно: текстом он не бывает — на нём держатся градиенты
    // и волосяные линии, а их читаемость судится глазом, как границы и затемнение.
    const checked = new Set<string>([
      ...textPairs.flat(),
      "border",
      "overlay",
      "shadow",
      "secondary",
    ]);

    expect([...paletteKeys].filter((key) => !checked.has(key))).toEqual([]);
  });

  it("ships every scheme on the current token contract", () => {
    for (const scheme of shippedSchemes) {
      expect(scheme.tokenContract, scheme.id).toBe(tokenContractMajor);
    }
  });

  it("ships only the retained schemes", () => {
    expect(shippedSchemes.map((scheme) => scheme.id)).toEqual(["imperium", "nord", "oled", "sage"]);
  });
});

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  );

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** WCAG 2.1, относительная яркость. Прозрачность в этих парах не участвует. */
function relativeLuminance(color: string): number {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}
