/**
 * Встроенная схема. Она есть всегда: заменить её нечем, пока плагинов со схемами нет, и именно её
 * называет `preferences.json` по умолчанию.
 */

import { baseColorScheme } from "@sovereign/protocol";

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const baseScheme: ColorScheme = {
  id: baseColorScheme,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#f7f8fa",
      surfaceRaised: "#ffffff",
      surfaceSunken: "#eceef2",
      border: "#d3d8e0",
      ink: "#171a1f",
      inkMuted: "#5b6472",
      accent: "#2f6feb",
      accentInk: "#ffffff",
      secondary: "#6d4bc4",
      danger: "#c0362c",
      dangerInk: "#ffffff",
      warning: "#8a5300",
      success: "#136c3f",
      overlay: "#0f121680",
      shadow: "#0f12161f",
    },
    dark: {
      surface: "#14161a",
      surfaceRaised: "#1c1f25",
      surfaceSunken: "#0f1114",
      border: "#2c313a",
      ink: "#eef1f5",
      inkMuted: "#9aa4b2",
      accent: "#5b9bff",
      accentInk: "#0b1220",
      secondary: "#a98cff",
      danger: "#ef6b5f",
      dangerInk: "#1a0d0b",
      warning: "#e0a33a",
      success: "#4cc38a",
      overlay: "#00000099",
      shadow: "#00000080",
    },
  },
};
