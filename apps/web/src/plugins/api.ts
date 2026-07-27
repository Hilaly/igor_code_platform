/**
 * Запросы вью плагинов: снимок состояния и запись решения человека. Источник истины — демон и
 * `preferences.json` за ним (ADR-0033): вью не держит своей копии настроек, а спрашивает и пишет.
 */

import {
  pluginPreferencesPath,
  pluginsPath,
  type PluginPreferences,
  type PluginPreferencesUpdated,
  type PluginsSnapshot,
} from "@sovereign/protocol";

export async function fetchPluginsSnapshot(signal?: AbortSignal): Promise<PluginsSnapshot> {
  const response = await fetch(pluginsPath, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(`the daemon answered ${response.status}`);
  }

  return (await response.json()) as PluginsSnapshot;
}

/**
 * Записывает запись плагина целиком: тело — то же, что лежит в файле. Отказ `409` означает, что
 * файл на диске правил кто-то ещё; разобраться с этим может только человек, поэтому повтора здесь
 * нет — причина уходит наверх.
 */
export async function writePluginPreferences(
  pluginKey: string,
  preferences: PluginPreferences,
): Promise<PluginPreferencesUpdated> {
  const response = await fetch(pluginPreferencesPath(pluginKey), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preferences),
  });

  if (!response.ok) {
    const failure = (await response.json()) as { error?: string };

    throw new Error(failure.error ?? `the daemon answered ${response.status}`);
  }

  return (await response.json()) as PluginPreferencesUpdated;
}
