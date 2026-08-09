import { convert, resolve } from "@asamuzakjp/css-color";

import type { Roles } from "./roles.ts";

export const minimumSecondaryActionContrast = 4.5;

type Rgba = readonly [number, number, number, number];

export type ForegroundChoice = {
  foreground: string;
  contrast: number;
};

export function chooseLegibleForeground(
  candidates: readonly string[],
  backgrounds: readonly string[],
  supportingSurfaces: readonly string[],
): ForegroundChoice {
  const [first, ...rest] = candidates;

  if (first === undefined) {
    throw new Error("a filled secondary action has no foreground candidates");
  }

  return rest.reduce<ForegroundChoice>(
    (mostLegible, candidate) => {
      const contrast = minimumContrast(candidate, backgrounds, supportingSurfaces);

      return contrast > mostLegible.contrast ? { foreground: candidate, contrast } : mostLegible;
    },
    {
      foreground: first,
      contrast: minimumContrast(first, backgrounds, supportingSurfaces),
    },
  );
}

/** Пересчитывает зависимую роль после ручных overrides, пока автор не переопределил её сам. */
export function chooseSecondaryActionForeground(roles: Roles): ForegroundChoice {
  return chooseLegibleForeground(
    [
      roles.text,
      roles.pageSurface,
      roles.panelSurface,
      roles.sunkenSurface,
      roles.textOnAccent,
      roles.textOnDanger,
    ],
    [roles.secondary, roles.secondaryHover, roles.secondaryStrong],
    [roles.pageSurface, roles.panelSurface],
  );
}

/** Худший реальный контраст одного текста на base/hover/strong secondary-кнопки. */
export function secondaryActionContrastRatio(roles: Roles): number {
  return minimumContrast(
    roles.textOnSecondary,
    [roles.secondary, roles.secondaryHover, roles.secondaryStrong],
    [roles.pageSurface, roles.panelSurface],
  );
}

function minimumContrast(
  foreground: string,
  backgrounds: readonly string[],
  supportingSurfaces: readonly string[],
): number {
  return Math.min(
    ...backgrounds.map((background) => contrastRatio(foreground, background, supportingSurfaces)),
  );
}

function colorChannels(color: string): Rgba {
  const resolved = resolve(color);

  if (resolved === null) {
    throw new Error(`the colour ${color} cannot be resolved`);
  }

  const [red = 0, green = 0, blue = 0, alpha = 1] = convert.colorToRgb(resolved);

  return [red / 255, green / 255, blue / 255, alpha];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);

  if (alpha === 0) {
    return [0, 0, 0, 0];
  }

  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
}

function renderLayers(colors: readonly string[]): Rgba {
  const [first, ...rest] = colors;

  if (first === undefined) {
    throw new Error("a rendered colour has no supporting surface");
  }

  return rest.reduce(
    (background, color) => composite(colorChannels(color), background),
    colorChannels(first),
  );
}

function relativeLuminance(color: Rgba): number {
  const channels = color
    .slice(0, 3)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrastRatio(
  foreground: string,
  background: string,
  supportingSurfaces: readonly string[],
): number {
  const renderedSupport = renderLayers(supportingSurfaces);
  const renderedBackground = composite(colorChannels(background), renderedSupport);
  const renderedForeground = composite(colorChannels(foreground), renderedBackground);
  const [lighter, darker] = [
    relativeLuminance(renderedForeground),
    relativeLuminance(renderedBackground),
  ].sort((left, right) => right - left);

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}
