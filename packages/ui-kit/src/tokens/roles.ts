/**
 * Роли — семантические токены, которые читают компоненты. Кит выводит их из палитры (docs/ui-kit.md):
 * роль можно добавить, не меняя ни одной схемы.
 *
 * Оттенки состояний не задаются палитрой, а считаются от неё через `color-mix`: правило одно на все
 * схемы — состояние двигает цвет к тексту, то есть в светлом варианте темнеет, а в тёмном светлеет.
 * Иначе автору схемы пришлось бы объявлять по три оттенка на каждое действие.
 *
 * Состояния выведены по одному шаблону — заливка, граница и текст на каждое: `<состояние>Surface`
 * разбавляет цвет поверхностью, `<состояние>Border` — прозрачностью, `<состояние>Text` уводит цвет к
 * основному тексту, чтобы цветная надпись оставалась читаемой на светлой поверхности.
 */

import type { Palette } from "./palette.ts";

export const roleNames = [
  "pageSurface",
  "panelSurface",
  "sunkenSurface",
  /** Нейтральная заливка внутри панели: дорожка индикатора, полоса-заглушка. */
  "fillSurface",
  /** Та же заливка на шаг заметнее: дальний кадр мерцания заглушки. */
  "fillSurfaceStrong",
  "border",
  /** Линия, которая обязана быть видна: полоса прокрутки, край поднятого слоя. */
  "borderStrong",
  /** Линия, которой почти нет: разделитель внутри плотного списка. */
  "borderSubtle",
  "text",
  "textMuted",
  /** Третья ступень текста: подсказка в поле ввода, единицы измерения. */
  "textSubtle",
  "textOnAccent",
  "accent",
  "accentHover",
  /** Акцент на шаг глубже: нажатое состояние и особо заметная смысловая метка. */
  "accentStrong",
  "accentSurface",
  /** Граница акцентной заливки и ореол вокруг поля в фокусе. */
  "accentBorder",
  /** Акцент как цвет текста: ссылка на странице, где сам акцент был бы слишком светлым. */
  "accentText",
  "controlSurface",
  "controlSurfaceHover",
  "focusRing",
  /** Второй акцент для редких ключевых действий и смысловых меток. */
  "secondary",
  "secondaryHover",
  "secondaryStrong",
  "secondarySurface",
  "secondaryBorder",
  "secondaryText",
  "danger",
  "dangerSurface",
  "dangerBorder",
  "dangerText",
  "textOnDanger",
  "warning",
  "warningSurface",
  "warningBorder",
  "warningText",
  "success",
  "successSurface",
  "successBorder",
  "successText",
  /** Сообщение к сведению. Своего значения в палитре нет: это акцент, сведённый к нейтральному. */
  "info",
  "infoSurface",
  "infoBorder",
  "infoText",
  "overlay",
  "shadow",
] as const;

export type RoleName = (typeof roleNames)[number];

export type Roles = Record<RoleName, string>;

/** Смещение состояния: 8% к тексту — заметно на глаз и не меняет смысла цвета. */
const hoverShift = "8%";

export function deriveRoles(palette: Palette): Roles {
  const towardsInk = (color: string, amount: string): string =>
    `color-mix(in oklab, ${color} ${100 - Number.parseFloat(amount)}%, ${palette.ink} ${amount})`;

  /** Заливка состояния: цвет, разбавленный поднятой поверхностью до фона, на котором читается текст. */
  const softSurface = (color: string): string =>
    `color-mix(in oklab, ${color} 14%, ${palette.surfaceRaised} 86%)`;

  /** Граница заливки: тот же цвет прозрачностью, поэтому она ложится на любую поверхность под ней. */
  const softBorder = (color: string): string => `color-mix(in oklab, ${color} 30%, transparent)`;

  /** Цветной текст: цвет остаётся различим, но основной текст даёт ему рабочий контраст. */
  const readableText = (color: string): string =>
    `color-mix(in oklab, ${color} 25%, ${palette.ink} 75%)`;

  /** Второстепенный текст чуть сдвинут к основному ради утопленной поверхности полей. */
  const readableMuted = `color-mix(in oklab, ${palette.inkMuted} 96%, ${palette.ink} 4%)`;

  // Своего значения у «к сведению» в палитре нет: акцент, сведённый к второстепенному тексту.
  const info = `color-mix(in oklab, ${palette.accent} 55%, ${palette.inkMuted} 45%)`;

  return {
    pageSurface: palette.surface,
    panelSurface: palette.surfaceRaised,
    sunkenSurface: palette.surfaceSunken,
    fillSurface: towardsInk(palette.surfaceRaised, "6%"),
    fillSurfaceStrong: towardsInk(palette.surfaceRaised, "12%"),
    border: palette.border,
    borderStrong: `color-mix(in oklab, ${palette.border} 65%, ${palette.inkMuted} 35%)`,
    borderSubtle: softBorder(palette.border),
    text: palette.ink,
    textMuted: readableMuted,
    textSubtle: readableMuted,
    textOnAccent: palette.accentInk,
    accent: palette.accent,
    accentHover: towardsInk(palette.accent, hoverShift),
    // Палитра гарантирует контраст `accentInk` только на исходном акценте. Сильное состояние
    // остаётся тем же заполнением, а различие pressed даёт утопленная `accentSurface`.
    accentStrong: palette.accent,
    // Фон выбранной строки: акцент, разбавленный поверхностью, — иначе выделение перекрикивает текст.
    accentSurface: `color-mix(in oklab, ${palette.accent} 16%, ${palette.surface} 84%)`,
    accentBorder: softBorder(palette.accent),
    accentText: readableText(palette.accent),
    controlSurface: palette.surfaceRaised,
    controlSurfaceHover: towardsInk(palette.surfaceRaised, hoverShift),
    // Кольцо фокуса разбавлено текстом поверх акцента: на тёмной схеме чистый акцент сливается с ней.
    focusRing: `color-mix(in oklab, ${palette.accent} 72%, ${palette.accentInk} 28%)`,
    secondary: palette.secondary,
    secondaryHover: towardsInk(palette.secondary, hoverShift),
    secondaryStrong: towardsInk(palette.secondary, "18%"),
    secondarySurface: softSurface(palette.secondary),
    secondaryBorder: softBorder(palette.secondary),
    secondaryText: readableText(palette.secondary),
    danger: palette.danger,
    dangerSurface: softSurface(palette.danger),
    dangerBorder: softBorder(palette.danger),
    dangerText: readableText(palette.danger),
    textOnDanger: palette.dangerInk,
    warning: palette.warning,
    warningSurface: softSurface(palette.warning),
    warningBorder: softBorder(palette.warning),
    warningText: readableText(palette.warning),
    success: palette.success,
    successSurface: softSurface(palette.success),
    successBorder: softBorder(palette.success),
    successText: readableText(palette.success),
    info,
    infoSurface: softSurface(info),
    infoBorder: softBorder(info),
    infoText: readableText(info),
    overlay: palette.overlay,
    shadow: palette.shadow,
  };
}

/**
 * Имя CSS-переменной роли. Префикс есть, потому что переменные живут на корне документа вместе с
 * чужими: браузерный код плагина исполняется в том же realm (docs/ui-extension-model.md).
 */
export function rolePropertyName(role: RoleName): string {
  return `--sovereign-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
