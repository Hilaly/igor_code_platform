/**
 * Схема «obsidian», перенесённая из кита предыдущего захода на проект (docs/roadmap.md, срез 5).
 * Почти монохром: акцент — тёплый графит, цвет остаётся только у состояний.
 *
 * Схема конвертирована, а не скопирована: у источника палитра была CSS-файлом на тему, у нас это
 * данные, иначе её не сможет принести плагин (docs/ui-kit.md). Светлота отдельных значений сдвинута
 * до нашего порога контраста — тон и насыщенность остались исходными.
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const obsidianSchemeId = "obsidian";

export const obsidianScheme: ColorScheme = {
  id: obsidianSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#f4f4f3",
      surfaceRaised: "#fbf8f7",
      surfaceSunken: "#e7e7e6",
      border: "#cdcfce",
      ink: "#1f2022",
      inkMuted: "#5f6368",
      accent: "#67717c",
      accentInk: "#fafaf9",
      secondary: "#a79f94",
      danger: "#ac5353",
      dangerInk: "#fafaf9",
      warning: "#9d5e0b",
      success: "#4a785f",
      overlay: "#14141680",
      shadow: "#1414161f",
    },
    dark: {
      surface: "#0d0f10",
      surfaceRaised: "#181b1e",
      surfaceSunken: "#1b1d1e",
      border: "#2d3338",
      ink: "#eef1f3",
      inkMuted: "#a4acb3",
      accent: "#8c98a6",
      accentInk: "#0d0f10",
      secondary: "#b5aa9c",
      danger: "#c77474",
      dangerInk: "#0d0f10",
      warning: "#d5a05a",
      success: "#76a388",
      overlay: "#00000099",
      shadow: "#00000080",
    },
  },
};
