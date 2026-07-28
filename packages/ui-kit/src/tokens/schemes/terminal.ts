/**
 * Схема «terminal», перенесённая из кита предыдущего захода на проект (docs/roadmap.md, срез 5).
 * Tokyo Night: холодный синий на графите, самая тёмная из перенесённых тем.
 *
 * Схема конвертирована, а не скопирована: у источника палитра была CSS-файлом на тему, у нас это
 * данные, иначе её не сможет принести плагин (docs/ui-kit.md). Светлота отдельных значений сдвинута
 * до нашего порога контраста — тон и насыщенность остались исходными.
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const terminalSchemeId = "terminal";

export const terminalScheme: ColorScheme = {
  id: terminalSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#e1e2e7",
      surfaceRaised: "#f0f1f5",
      surfaceSunken: "#d3d5e0",
      border: "#c6c9d6",
      ink: "#373d55",
      inkMuted: "#586181",
      accent: "#015fcb",
      accentInk: "#e1e2e7",
      secondary: "#9854f1",
      danger: "#c50041",
      dangerInk: "#e1e2e7",
      warning: "#7d5d2f",
      success: "#4f6c30",
      overlay: "#373d5580",
      shadow: "#373d551f",
    },
    dark: {
      surface: "#101216",
      surfaceRaised: "#16191f",
      surfaceSunken: "#0b0d11",
      border: "#262b36",
      ink: "#d7dae0",
      inkMuted: "#8b91a0",
      accent: "#7aa2f7",
      accentInk: "#0b0d11",
      secondary: "#bb9af7",
      danger: "#f7768e",
      dangerInk: "#0b0d11",
      warning: "#e0af68",
      success: "#9ece6a",
      overlay: "#00000099",
      shadow: "#00000080",
    },
  },
};
