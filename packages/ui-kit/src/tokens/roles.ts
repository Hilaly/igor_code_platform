/**
 * Роли — семантические токены, которые читают компоненты. Кит выводит их из палитры (ADR-0031):
 * роль можно добавить, не меняя ни одной схемы.
 *
 * Оттенки состояний не задаются палитрой, а считаются от неё через `color-mix`: правило одно на все
 * схемы — состояние двигает цвет к тексту, то есть в светлом варианте темнеет, а в тёмном светлеет.
 * Иначе автору схемы пришлось бы объявлять по три оттенка на каждое действие.
 */

import type { Palette } from "./palette.ts";

export const roleNames = [
  "pageSurface",
  "panelSurface",
  "sunkenSurface",
  "border",
  "text",
  "textMuted",
  "textOnAccent",
  "accent",
  "accentHover",
  "accentSurface",
  "controlSurface",
  "controlSurfaceHover",
  "focusRing",
  "danger",
  "textOnDanger",
  "warning",
  "success",
  "overlay",
] as const;

export type RoleName = (typeof roleNames)[number];

export type Roles = Record<RoleName, string>;

/** Смещение состояния: 8% к тексту — заметно на глаз и не меняет смысла цвета. */
const hoverShift = "8%";

export function deriveRoles(palette: Palette): Roles {
  const towardsInk = (color: string, amount: string): string =>
    `color-mix(in oklab, ${color} ${100 - Number.parseFloat(amount)}%, ${palette.ink} ${amount})`;

  return {
    pageSurface: palette.surface,
    panelSurface: palette.surfaceRaised,
    sunkenSurface: palette.surfaceSunken,
    border: palette.border,
    text: palette.ink,
    textMuted: palette.inkMuted,
    textOnAccent: palette.accentInk,
    accent: palette.accent,
    accentHover: towardsInk(palette.accent, hoverShift),
    // Фон выбранной строки: акцент, разбавленный поверхностью, — иначе выделение перекрикивает текст.
    accentSurface: `color-mix(in oklab, ${palette.accent} 16%, ${palette.surface} 84%)`,
    controlSurface: palette.surfaceRaised,
    controlSurfaceHover: towardsInk(palette.surfaceRaised, hoverShift),
    focusRing: palette.accent,
    danger: palette.danger,
    textOnDanger: palette.dangerInk,
    warning: palette.warning,
    success: palette.success,
    overlay: palette.overlay,
  };
}

/**
 * Имя CSS-переменной роли. Префикс есть, потому что переменные живут на корне документа вместе с
 * чужими: браузерный код плагина исполняется в том же realm (ADR-0023).
 */
export function rolePropertyName(role: RoleName): string {
  return `--sovereign-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
