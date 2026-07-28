/**
 * Схема «oled»: глубокий чёрный фон #000000 для OLED-дисплеев с неоновыми акцентами циана и мадженты.
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const oledSchemeId = "oled";

export const oledScheme: ColorScheme = {
  id: oledSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#f0f2f5",
      surfaceRaised: "#ffffff",
      surfaceSunken: "#e4e7eb",
      border: "#d0d5dd",
      ink: "#0f172a",
      inkMuted: "#475569",
      accent: "#0369a1",
      accentInk: "#ffffff",
      secondary: "#7c3aed",
      danger: "#b91c1c",
      dangerInk: "#ffffff",
      warning: "#92400e",
      success: "#166534",
      overlay: "#0f172a80",
      shadow: "#0f172a1f",
    },
    dark: {
      surface: "#000000",
      surfaceRaised: "#0a0a0c",
      surfaceSunken: "#000000",
      border: "#1f1f23",
      ink: "#f8fafc",
      inkMuted: "#94a3b8",
      accent: "#00f0ff",
      accentInk: "#000000",
      secondary: "#f000ff",
      danger: "#ff3366",
      dangerInk: "#000000",
      warning: "#ffb800",
      success: "#00ff88",
      overlay: "#000000e6",
      shadow: "#000000b3",
    },
  },
};
