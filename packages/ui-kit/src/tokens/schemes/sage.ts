/**
 * Схема «sage»: природные шалфейные и глиняно-терракотовые тона.
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const sageSchemeId = "sage";

export const sageScheme: ColorScheme = {
  id: sageSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#f4f6f4",
      surfaceRaised: "#ffffff",
      surfaceSunken: "#e8ece8",
      border: "#cdd6cd",
      ink: "#1c2820",
      inkMuted: "#526356",
      accent: "#2d6a4f",
      accentInk: "#ffffff",
      secondary: "#994355",
      danger: "#bc4749",
      dangerInk: "#ffffff",
      warning: "#7c4a27",
      success: "#386641",
      overlay: "#1c282080",
      shadow: "#1c28201f",
    },
    dark: {
      surface: "#121a14",
      surfaceRaised: "#18221b",
      surfaceSunken: "#0d130f",
      border: "#29382e",
      ink: "#e2ebd0",
      inkMuted: "#95a897",
      accent: "#52b788",
      accentInk: "#0d130f",
      secondary: "#e5989b",
      danger: "#ff5260",
      dangerInk: "#0d130f",
      warning: "#e9c46a",
      success: "#74c69d",
      overlay: "#080c0999",
      shadow: "#080c0980",
    },
  },
};
