/**
 * Маршрут переключения плагина. Тело запроса — `PluginPreferences`, то есть ровно та запись, что
 * лежит в `preferences.json`: файл остаётся источником истины, а API — вторым способом его
 * изменить (docs/plugins.md, docs/data-directory.md).
 */

import type { PluginPreferences } from "./settings.ts";
import { pluginsPath } from "./plugins-snapshot.ts";

/** Шаблон для таблицы маршрутов демона: `:key` — это `<источник>:<id>`. */
export const pluginPreferencesPathPattern = `${pluginsPath}/:key/preferences`;

/** Ключ уезжает в путь, а двоеточие в нём требует кодирования. */
export function pluginPreferencesPath(pluginKey: string): string {
  return `${pluginsPath}/${encodeURIComponent(pluginKey)}/preferences`;
}

/**
 * Ответ: что именно записано. Состояния плагинов здесь нет намеренно — оно приходит потоком, а
 * снимок этого момента назвал бы ещё прежнее.
 */
export type PluginPreferencesUpdated = {
  key: string;
  preferences: PluginPreferences;
};
