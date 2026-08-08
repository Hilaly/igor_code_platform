import { convert, resolve } from "@asamuzakjp/css-color";
import { interfaceScales } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { applyRoles, applyScale, scaleAttributeName } from "./apply.ts";
import { paletteKeys, paletteVariants, type Palette } from "./palette.ts";
import { deriveRoles, roleNames, rolePropertyName, type RoleName } from "./roles.ts";
import { parseColorScheme, resolveScheme, tokenContractMajor, type ColorScheme } from "./scheme.ts";
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

describe("parseColorScheme", () => {
  const document = {
    tokenContract: tokenContractMajor,
    variants: { light: imperiumScheme.variants.light, dark: imperiumScheme.variants.dark },
  };

  it("names the scheme by the identifier it is given: the document carries no name of its own", () => {
    const parsed = parseColorScheme("themed.midnight", document);

    expect(parsed.kind === "parsed" && parsed.scheme.id).toBe("themed.midnight");
    expect(parsed.kind === "parsed" && parsed.scheme.variants.dark.surface).toBe(
      imperiumScheme.variants.dark.surface,
    );
  });

  it("refuses an incomplete palette whole and names what is missing", () => {
    const withoutTwoKeys = Object.fromEntries(
      Object.entries(imperiumScheme.variants.light).filter(
        ([key]) => key !== "secondary" && key !== "shadow",
      ),
    );
    const parsed = parseColorScheme("themed.midnight", {
      ...document,
      variants: { ...document.variants, light: withoutTwoKeys },
    });

    // Пропущенный ключ дал бы `color-mix(… undefined …)`, то есть сломанный CSS вместо отказа.
    expect(parsed.kind).toBe("refused");
    expect(parsed.kind === "refused" && parsed.reason).toMatch(/secondary, shadow/);
  });

  it("refuses a scheme that brought only one variant", () => {
    const parsed = parseColorScheme("themed.midnight", {
      ...document,
      variants: { dark: imperiumScheme.variants.dark },
    });

    expect(parsed.kind === "refused" && parsed.reason).toMatch(/no light palette/);
  });

  it("takes a foreign token contract: refusing it is the job of resolveScheme, and only its", () => {
    const parsed = parseColorScheme("themed.ancient", { ...document, tokenContract: 1 });

    expect(parsed.kind).toBe("parsed");
    expect(parsed.kind === "parsed" && resolveScheme(parsed.scheme, "light").kind).toBe("rejected");
  });

  it("keeps the declared role overrides, unknown names included", () => {
    const parsed = parseColorScheme("themed.midnight", {
      ...document,
      roleOverrides: { accent: "#123456", neonEdge: "#654321" },
    });
    const resolved = parsed.kind === "parsed" ? resolveScheme(parsed.scheme, "light") : undefined;

    expect(resolved?.kind === "resolved" && resolved.roles.accent).toBe("#123456");
    expect(resolved?.diagnostics.join("\n")).toMatch(/unknown role neonEdge/);
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

  const rolePairs = [
    ["text", "pageSurface"],
    ["textMuted", "pageSurface"],
    ["textSubtle", "pageSurface"],
    ["accentText", "pageSurface"],
    ["dangerText", "pageSurface"],
    ["warningText", "pageSurface"],
    ["successText", "pageSurface"],
    ["text", "panelSurface"],
    ["textMuted", "panelSurface"],
    ["textSubtle", "panelSurface"],
    ["accentText", "panelSurface"],
    ["dangerText", "panelSurface"],
    ["warningText", "panelSurface"],
    ["text", "sunkenSurface"],
    ["textMuted", "sunkenSurface"],
    ["textSubtle", "sunkenSurface"],
    ["text", "controlSurface"],
    ["textMuted", "controlSurface"],
    ["text", "controlSurfaceHover"],
    ["textMuted", "controlSurfaceHover"],
    ["accentText", "controlSurfaceHover"],
    ["text", "fillSurface"],
    ["textMuted", "fillSurface"],
    ["text", "accentSurface"],
    ["accentText", "accentSurface"],
    ["dangerText", "dangerSurface"],
    ["warningText", "warningSurface"],
    ["successText", "successSurface"],
    ["infoText", "infoSurface"],
    ["textOnAccent", "accent"],
    ["textOnAccent", "accentHover"],
    ["textOnAccent", "accentStrong"],
    ["textOnDanger", "danger"],
  ] as const satisfies readonly (readonly [RoleName, RoleName])[];

  it("includes warning text rendered inside plugin panels", () => {
    expect(rolePairs).toContainEqual(["warningText", "panelSurface"]);
  });

  it("keeps every consumed text role legible on its actual surface", () => {
    const failures: string[] = [];

    for (const scheme of shippedSchemes) {
      for (const variant of paletteVariants) {
        const roles = deriveRoles(scheme.variants[variant]);

        for (const [text, background] of rolePairs) {
          const ratio = contrastRatio(roles[text], roles[background]);

          if (ratio < 4.5) {
            failures.push(
              `${scheme.id} ${variant}: ${text} on ${background} is ${ratio.toFixed(2)}:1`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the translucent Notice body legible after alpha composition", () => {
    const noticePairs = [
      ["infoText", "infoSurface"],
      ["warningText", "warningSurface"],
      ["dangerText", "dangerSurface"],
    ] as const satisfies readonly (readonly [RoleName, RoleName])[];

    const failures: string[] = [];

    for (const scheme of shippedSchemes) {
      for (const variant of paletteVariants) {
        const roles = deriveRoles(scheme.variants[variant]);

        for (const [text, background] of noticePairs) {
          const translucentText = `color-mix(in srgb, ${resolvedColor(roles[text])} 82%, transparent)`;
          const ratio = contrastRatio(translucentText, roles[background]);

          if (ratio < 4.5) {
            failures.push(
              `${scheme.id} ${variant}: translucent ${text} on ${background} is ${ratio.toFixed(2)}:1`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("covers the whole palette between the pairs and what is not text", () => {
    // Второй акцент здесь не проверяется намеренно: он служит смысловым меткам и надзаголовкам, а не
    // тексту на фоне, поэтому к нему неприменима эта проверка контраста текстовых пар.
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
  const background = rgbChannels(second);
  const foreground = composite(rgbChannels(first), background);
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (left, right) => right - left,
  );

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

type Rgba = readonly [number, number, number, number];

function resolvedColor(color: string): string {
  const resolved = resolve(color);

  expect(resolved, `CSS color must resolve: ${color}`).not.toBeNull();
  return resolved ?? "";
}

function rgbChannels(color: string): Rgba {
  const channels = convert.colorToRgb(resolvedColor(color));

  expect(channels, `CSS color must convert to RGB: ${color}`).toHaveLength(4);
  return [
    (channels[0] ?? 0) / 255,
    (channels[1] ?? 0) / 255,
    (channels[2] ?? 0) / 255,
    channels[3] ?? 1,
  ];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);

  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
}

/** WCAG 2.1 relative luminance from standards-aware, resolved sRGB channels. */
function relativeLuminance(color: Rgba): number {
  const channels = color
    .slice(0, 3)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}
