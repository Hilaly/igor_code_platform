/**
 * Схема «nord», перенесённая из кита предыдущего захода на проект (docs/roadmap.md, срез 5).
 * Nord: приглушённая арктическая гамма, низкая насыщенность во всех ролях.
 *
 * Схема конвертирована, а не скопирована: у источника палитра была CSS-файлом на тему, у нас это
 * данные, иначе её не сможет принести плагин (docs/ui-kit.md). Светлота отдельных значений сдвинута
 * до нашего порога контраста — тон и насыщенность остались исходными.
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const nordSchemeId = "nord";

export const nordScheme: ColorScheme = {
  id: nordSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#eceff4",
      surfaceRaised: "#f8fafc",
      surfaceSunken: "#e1e4e9",
      border: "#d8dee9",
      ink: "#2e3440",
      inkMuted: "#4c566a",
      accent: "#496c97",
      accentInk: "#eceff4",
      secondary: "#88c0d0",
      danger: "#aa4c55",
      dangerInk: "#eceff4",
      warning: "#856525",
      success: "#587341",
      overlay: "#2e344080",
      shadow: "#2e34401f",
    },
    dark: {
      surface: "#2e3440",
      surfaceRaised: "#3b4252",
      surfaceSunken: "#393f4b",
      border: "#4c566a",
      ink: "#eceff4",
      inkMuted: "#d8dee9",
      accent: "#81a1c1",
      accentInk: "#2e3440",
      secondary: "#88c0d0",
      danger: "#e0828b",
      dangerInk: "#2e3440",
      warning: "#ebcb8b",
      success: "#a3be8c",
      overlay: "#00000099",
      shadow: "#00000080",
    },
  },
};
