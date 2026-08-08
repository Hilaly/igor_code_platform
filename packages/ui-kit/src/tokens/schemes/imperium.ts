/**
 * Схема «imperium»: пурпур и золото на тёплой бумаге, единственная тема со вторым акцентом в деле.
 * Тёмный вариант повторяет утверждённую Refined Imperium палитру буквально. Производные роли
 * строятся отдельно, поэтому схема остаётся 15-ключевым публичным контрактом.
 */

import { defineBuiltInRoleOverrides } from "../built-in-role-overrides.ts";
import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const imperiumSchemeId = "imperium";

export const imperiumScheme: ColorScheme = defineBuiltInRoleOverrides(
  {
    id: imperiumSchemeId,
    tokenContract: tokenContractMajor,
    variants: {
      light: {
        surface: "#f3ead8",
        surfaceRaised: "#fffaf0",
        surfaceSunken: "#e7dcc5",
        border: "#d1bea0",
        ink: "#2b2620",
        inkMuted: "#6a6153",
        accent: "#642a97",
        accentInk: "#f7f1e6",
        secondary: "#946a20",
        danger: "#a84a48",
        dangerInk: "#f7f1e6",
        warning: "#955a00",
        success: "#437157",
        overlay: "#2e2a3380",
        shadow: "#2e2a331f",
      },
      dark: {
        surface: "#100b09",
        surfaceRaised: "#1f1814",
        surfaceSunken: "#130e0c",
        border: "#2a221e",
        ink: "#f4ede7",
        inkMuted: "#c8b9ae",
        accent: "#8e44ad",
        accentInk: "#fff8f3",
        secondary: "#c5a059",
        danger: "#df7b73",
        dangerInk: "#100b09",
        warning: "#e0b66c",
        success: "#91bb8b",
        overlay: "#100b09cc",
        shadow: "#100b09a6",
      },
    },
  },
  {
    dark: {
      controlSurface: "#261c18",
      accentSurface: "#3b2256",
      accentStrong: "#482b68",
      borderStrong: "#362c27",
    },
  },
);
