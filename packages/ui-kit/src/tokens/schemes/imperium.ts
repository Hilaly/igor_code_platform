/**
 * Схема «imperium»: пурпур и золото на тёплой бумаге, единственная тема со вторым акцентом в деле.
 * Светлота отдельных значений сдвинута до нашего порога контраста — тон и насыщенность остались
 * исходными (docs/ui-kit.md).
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const imperiumSchemeId = "imperium";

export const imperiumScheme: ColorScheme = {
  id: imperiumSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#f2e9d6",
      surfaceRaised: "#fdfaf1",
      surfaceSunken: "#e9dfc8",
      border: "#d8c8a2",
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
      surface: "#17130d",
      surfaceRaised: "#1e1811",
      surfaceSunken: "#100d08",
      border: "#3b3122",
      ink: "#ece6da",
      inkMuted: "#b3a893",
      accent: "#b07fe3",
      accentInk: "#17130d",
      secondary: "#d3af6e",
      danger: "#d0736f",
      dangerInk: "#17130d",
      warning: "#d8a75c",
      success: "#88ac83",
      overlay: "#0c070299",
      shadow: "#0c070280",
    },
  },
};
