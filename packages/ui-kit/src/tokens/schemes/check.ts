/**
 * Проверочная схема (ADR-0031). Значения палитры заведомо дикие: на ней участок, покрашенный мимо
 * токена, виден с первого взгляда, а не в чужом баг-репорте.
 *
 * Дикие — но читаемые: контраст текста к поверхности здесь такой же обязательный, как в встроенной
 * схеме, иначе на этой схеме нельзя работать, а значит ей не пользуются.
 */

import { tokenContractMajor, type ColorScheme } from "../scheme.ts";

export const checkSchemeId = "check";

export const checkScheme: ColorScheme = {
  id: checkSchemeId,
  tokenContract: tokenContractMajor,
  variants: {
    light: {
      surface: "#d4ff00",
      surfaceRaised: "#ff00d4",
      surfaceSunken: "#00ffe0",
      border: "#ff6a00",
      ink: "#000000",
      inkMuted: "#241a00",
      accent: "#4b0082",
      accentInk: "#ffff00",
      danger: "#8b0000",
      dangerInk: "#ffffff",
      warning: "#5a3d00",
      success: "#004d2a",
      overlay: "#ff00aa66",
    },
    dark: {
      surface: "#2b004a",
      surfaceRaised: "#004a3d",
      surfaceSunken: "#4a0020",
      border: "#ff00aa",
      ink: "#ffff00",
      inkMuted: "#00ffd0",
      accent: "#ff7ad9",
      accentInk: "#1a0033",
      danger: "#ff9a8a",
      dangerInk: "#2b0000",
      warning: "#ffd166",
      success: "#7dffb0",
      overlay: "#00ffd066",
    },
  },
};
