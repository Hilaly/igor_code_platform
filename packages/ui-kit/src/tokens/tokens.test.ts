import { convert, resolve } from "@asamuzakjp/css-color";
import { interfaceScales, type ColorSchemeDocument } from "@sovereign/protocol";
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

  it("rejects an incomplete derived role family for the secondary action", () => {
    const roles = deriveRoles(imperiumScheme.variants.dark);

    expect(roles).toMatchObject({
      secondary: imperiumScheme.variants.dark.secondary,
      secondaryHover: expect.any(String),
      secondaryStrong: expect.any(String),
      secondarySurface: expect.any(String),
      secondaryBorder: expect.any(String),
      secondaryText: expect.any(String),
      textOnSecondary: expect.any(String),
    });
  });
});

describe("imperiumScheme", () => {
  it("rejects the wrong dark Refined Imperium palette", () => {
    expect(imperiumScheme.variants.dark).toMatchObject({
      surface: "#100b09",
      surfaceRaised: "#1f1814",
      surfaceSunken: "#130e0c",
      border: "#2a221e",
      accent: "#8e44ad",
      secondary: "#c5a059",
    });
    expect(resolveScheme(imperiumScheme, "dark")).toMatchObject({
      kind: "resolved",
      roles: {
        controlSurface: "#261c18",
        accentSurface: "#3b2256",
        accentStrong: "#482b68",
        borderStrong: "#362c27",
      },
    });
    expect(imperiumScheme.variants.light).toMatchObject({
      surface: "#f3ead8",
      surfaceRaised: "#fffaf0",
      surfaceSunken: "#e7dcc5",
      border: "#d1bea0",
    });
  });

  it("keeps built-in role overrides out of the serialized scheme contract", () => {
    const serialized = JSON.parse(JSON.stringify(imperiumScheme)) as Record<string, unknown>;

    expect(Object.keys(serialized).sort()).toEqual(["id", "tokenContract", "variants"]);
    expect(resolveScheme({ ...imperiumScheme }, "dark")).toMatchObject({
      kind: "resolved",
      roles: { controlSurface: "#261c18" },
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

  it.each([
    ["light", "surface", ""],
    ["dark", "accent", "not-a-color"],
  ] as const)("refuses an unresolvable %s palette colour", (variant, role, value) => {
    const parsed = parseColorScheme("themed.broken", {
      ...document,
      variants: {
        ...document.variants,
        [variant]: { ...document.variants[variant], [role]: value },
      },
    });

    expect(parsed.kind).toBe("refused");
    expect(parsed.kind === "refused" && parsed.reason).toMatch(
      new RegExp(`${variant} palette.*${role}`),
    );
  });

  it("refuses an unresolvable override of a known role", () => {
    const parsed = parseColorScheme("themed.broken", {
      ...document,
      roleOverrides: { accent: "not-a-color" },
    });

    expect(parsed.kind).toBe("refused");
    expect(parsed.kind === "refused" && parsed.reason).toMatch(/role accent/);
  });

  it("ignores an unresolvable override whose role is unknown", () => {
    const parsed = parseColorScheme("themed.forward", {
      ...document,
      roleOverrides: { neonEdge: "not-a-color" },
    });
    const resolved = parsed.kind === "parsed" ? resolveScheme(parsed.scheme, "light") : undefined;

    expect(parsed.kind).toBe("parsed");
    expect(resolved?.kind).toBe("resolved");
    expect(resolved?.diagnostics.join("\n")).toMatch(/unknown role neonEdge/);
  });

  it.each([
    ["hex", "#123"],
    ["modern rgb", "rgb(12 34 56)"],
    ["legacy rgb", "rgb(12, 34, 56)"],
    ["hsl", "hsl(120 50% 40%)"],
    ["oklch", "oklch(60% 0.1 120)"],
    ["alpha", "rgb(12 34 56 / 0.5)"],
    ["color-mix", "color-mix(in oklab, red 40%, blue)"],
  ])("accepts a resolvable %s colour", (_syntax, value) => {
    const parsed = parseColorScheme("themed.functional", {
      ...document,
      variants: {
        ...document.variants,
        light: { ...document.variants.light, border: value },
      },
    });

    expect(parsed.kind).toBe("parsed");
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

  it("does not accept built-in role overrides from a plugin scheme document", () => {
    const parsed = parseColorScheme("themed.midnight", {
      ...document,
      builtInRoleOverrides: { dark: { controlSurface: "#261c18" } },
    } as ColorSchemeDocument);
    const resolved = parsed.kind === "parsed" ? resolveScheme(parsed.scheme, "dark") : undefined;

    expect(resolved?.kind === "resolved" && resolved.roles.controlSurface).not.toBe("#261c18");
  });

  it.each([
    ["rgb()", "rgb(20 20 20)", "rgb(230 230 230)", "rgb(190 135 30)"],
    ["hsl()", "hsl(0 0% 8%)", "hsl(0 0% 92%)", "hsl(40 73% 43%)"],
    ["oklch()", "oklch(20% 0 0)", "oklch(92% 0 0)", "oklch(65% 0.14 75)"],
  ])("keeps secondary action text legible for plugin %s colors", (_, dark, light, secondary) => {
    const parsed = parseColorScheme("themed.functional", {
      ...document,
      variants: {
        light: {
          ...document.variants.light,
          surface: dark,
          surfaceRaised: light,
          surfaceSunken: dark,
          ink: light,
          inkMuted: light,
          accentInk: dark,
          dangerInk: dark,
          secondary,
        },
        dark: document.variants.dark,
      },
    });
    const resolved = parsed.kind === "parsed" ? resolveScheme(parsed.scheme, "light") : undefined;

    expect(parsed.kind).toBe("parsed");
    expect(resolved?.kind).toBe("resolved");

    if (resolved?.kind !== "resolved") return;

    for (const background of ["secondary", "secondaryHover", "secondaryStrong"] as const) {
      expect(
        contrastRatio(resolved.roles.textOnSecondary, resolved.roles[background]),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("chooses one foreground that survives every opaque secondary action state", () => {
    const boundaryPalette = {
      ...document.variants.light,
      surface: "#ffffff",
      surfaceRaised: "#ffffff",
      surfaceSunken: "#f5f5f5",
      ink: "#000000",
      inkMuted: "#555555",
      accentInk: "#ffffff",
      dangerInk: "#ffffff",
      secondary: "#767676",
    };
    const parsed = parseColorScheme("themed.secondary-boundary", {
      ...document,
      variants: { ...document.variants, light: boundaryPalette },
    });
    const resolved = parsed.kind === "parsed" ? resolveScheme(parsed.scheme, "light") : undefined;

    expect(resolved?.kind).toBe("resolved");
    if (resolved?.kind !== "resolved") return;

    expect(resolved.roles.textOnSecondary).toBe("#ffffff");
    for (const background of ["secondary", "secondaryHover", "secondaryStrong"] as const) {
      expect(
        contrastRatioOnSurface(
          resolved.roles.textOnSecondary,
          resolved.roles[background],
          resolved.roles.panelSurface,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("rejects a translucent secondary when no foreground survives every rendered state", () => {
    const parsed = parseColorScheme("themed.secondary-alpha-boundary", {
      ...document,
      variants: {
        ...document.variants,
        light: {
          ...document.variants.light,
          surface: "#ffffff",
          surfaceRaised: "#ffffff",
          surfaceSunken: "#f5f5f5",
          ink: "#000000",
          inkMuted: "#555555",
          accentInk: "#ffffff",
          dangerInk: "#ffffff",
          secondary: "rgb(0 0 0 / 0.5)",
        },
      },
    });
    const resolved = parsed.kind === "parsed" ? resolveScheme(parsed.scheme, "light") : undefined;

    expect(resolved?.kind).toBe("rejected");
    expect(resolved?.diagnostics.join("\n")).toMatch(/secondary action.*contrast/i);
  });

  it("composites a translucent secondary before choosing its foreground", () => {
    const parsed = parseColorScheme("themed.secondary-alpha-valid", {
      ...document,
      variants: {
        ...document.variants,
        light: {
          ...document.variants.light,
          surface: "#ffffff",
          surfaceRaised: "#ffffff",
          surfaceSunken: "#f5f5f5",
          ink: "#000000",
          inkMuted: "#555555",
          accentInk: "#ffffff",
          dangerInk: "#ffffff",
          secondary: "rgb(0 0 0 / 0.3)",
        },
      },
    });
    const resolved = parsed.kind === "parsed" ? resolveScheme(parsed.scheme, "light") : undefined;

    expect(resolved?.kind).toBe("resolved");
    if (resolved?.kind !== "resolved") return;

    expect(resolved.roles.textOnSecondary).toBe("#000000");
    for (const background of ["secondary", "secondaryHover", "secondaryStrong"] as const) {
      expect(
        contrastRatioOnSurface(
          resolved.roles.textOnSecondary,
          resolved.roles[background],
          resolved.roles.panelSurface,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
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

  it("rejects a malformed palette defensively without throwing", () => {
    const scheme: ColorScheme = {
      ...imperiumScheme,
      variants: {
        ...imperiumScheme.variants,
        dark: { ...imperiumScheme.variants.dark, surface: "" },
      },
    };

    expect(() => resolveScheme(scheme, "dark")).not.toThrow();
    expect(resolveScheme(scheme, "dark")).toMatchObject({
      kind: "rejected",
      diagnostics: [expect.stringMatching(/dark palette.*surface/)],
    });
  });

  it("rejects a malformed known role override defensively without throwing", () => {
    const scheme: ColorScheme = {
      ...imperiumScheme,
      roleOverrides: { accent: "not-a-color" },
    };

    expect(() => resolveScheme(scheme, "light")).not.toThrow();
    expect(resolveScheme(scheme, "light")).toMatchObject({
      kind: "rejected",
      diagnostics: [expect.stringMatching(/role accent/)],
    });
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

  const selectedTabPair = ["accentText", "accentSurface"] as const satisfies readonly [
    RoleName,
    RoleName,
  ];
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
    selectedTabPair,
    ["dangerText", "dangerSurface"],
    ["warningText", "warningSurface"],
    ["successText", "successSurface"],
    ["infoText", "infoSurface"],
    ["textOnAccent", "accent"],
    ["textOnAccent", "accentHover"],
    ["textOnAccent", "accentStrong"],
    ["secondaryText", "pageSurface"],
    ["secondaryText", "panelSurface"],
    ["secondaryText", "secondarySurface"],
    ["textOnSecondary", "secondary"],
    ["textOnSecondary", "secondaryHover"],
    ["textOnSecondary", "secondaryStrong"],
    ["textOnDanger", "danger"],
  ] as const satisfies readonly (readonly [RoleName, RoleName])[];

  it("checks secondary action text on every filled secondary state", () => {
    expect(rolePairs).toEqual(
      expect.arrayContaining([
        ["textOnSecondary", "secondary"],
        ["textOnSecondary", "secondaryHover"],
        ["textOnSecondary", "secondaryStrong"],
      ]),
    );
  });

  it("keeps every consumed text role legible on its actual surface", () => {
    const failures: string[] = [];

    for (const scheme of shippedSchemes) {
      for (const variant of paletteVariants) {
        const resolved = resolveScheme(scheme, variant);
        expect(resolved.kind, `${scheme.id} ${variant}`).toBe("resolved");
        const roles =
          resolved.kind === "resolved" ? resolved.roles : deriveRoles(scheme.variants[variant]);

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
    // Второй акцент проверяется через производные ролевые пары выше: сама палитра не знает, какой
    // foreground выберет кит для заполненного secondary-действия.
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

function contrastRatioOnSurface(foreground: string, background: string, surface: string): number {
  const renderedBackground = composite(rgbChannels(background), rgbChannels(surface));
  const renderedForeground = composite(rgbChannels(foreground), renderedBackground);
  const [lighter, darker] = [
    relativeLuminance(renderedForeground),
    relativeLuminance(renderedBackground),
  ].sort((left, right) => right - left);

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
