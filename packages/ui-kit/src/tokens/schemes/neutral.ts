/**
 * Схема «neutral», перенесённая из кита предыдущего захода на проект (docs/roadmap.md, срез 5).
 * Нейтральная серая шкала: ахроматические поверхности, единственный цвет — акцент.
 *
 * Схема конвертирована, а не скопирована: у источника палитра была CSS-файлом на тему, у нас это
 * данные, иначе её не сможет принести плагин (docs/ui-kit.md). Светлота отдельных значений сдвинута
 * до нашего порога контраста — тон и насыщенность остались исходными.
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const neutralSchemeId = "neutral";

export const neutralScheme: ColorScheme = {
  id: neutralSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#fafafa",
      surfaceRaised: "#ffffff",
      surfaceSunken: "#ececec",
      border: "#e5e5e5",
      ink: "#181818",
      inkMuted: "#525252",
      accent: "#286fe4",
      accentInk: "#ffffff",
      secondary: "#737373",
      danger: "#e50015",
      dangerInk: "#ffffff",
      warning: "#a56200",
      success: "#00851d",
      overlay: "#00000080",
      shadow: "#0000001f",
    },
    dark: {
      surface: "#0a0a0a",
      surfaceRaised: "#181818",
      surfaceSunken: "#181818",
      border: "#262626",
      ink: "#f4f4f4",
      inkMuted: "#a1a1a1",
      accent: "#659dfb",
      accentInk: "#0a0a0a",
      secondary: "#a1a1a1",
      danger: "#f9262a",
      dangerInk: "#0a0a0a",
      warning: "#f3b01d",
      success: "#20c45f",
      overlay: "#00000099",
      shadow: "#00000080",
    },
  },
};
