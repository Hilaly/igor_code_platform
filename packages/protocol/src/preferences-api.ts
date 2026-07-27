/**
 * Маршрут внешнего вида и локали. Отдельно от `plugin-preferences.ts`, хотя файл настроек один: это
 * другое состояние с другим потребителем — оболочка спрашивает его на старте, до всякого знания о
 * плагинах.
 *
 * Записи плагинов этим маршрутом не отдаются и не меняются: у них свой маршрут и своя форма.
 */

import type { Appearance } from "./settings.ts";

export const preferencesPath = "/api/preferences";

/** Ответ на `GET` и тело `PUT`: ровно то, чем владеет оболочка. */
export type AppearancePreferences = {
  appearance: Appearance;
  locale: string;
};
