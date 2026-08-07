/**
 * Переключение плагина и его вкладов через веб-API (docs/plugins.md). Маршрут не трогает
 * супервизор напрямую: он пишет `preferences.json` и перечитывает его, а плагины поднимает и гасит
 * тот же путь, что и при правке файла руками. Двух способов привести систему в соответствие
 * настройкам не существует — иначе они разошлись бы (docs/data-directory.md).
 */

import {
  parsePluginPreferences,
  pluginPreferencesPathPattern,
  type PluginPreferencesUpdated,
} from "@sovereign/protocol";

import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { Logger } from "../platform/public.ts";
import type { PluginSupervisor } from "./plugin-supervisor.ts";
import type { SettingsStore } from "../settings/public.ts";

export type PluginPreferencesRouteOptions = {
  settings: Pick<SettingsStore, "writePluginPreferences">;
  /** Ключи, которые демон знает: переключать несуществующий плагин незачем. */
  plugins: Pick<PluginSupervisor, "statuses">;
  logger: Logger;
};

export function pluginPreferencesRoute(options: PluginPreferencesRouteOptions): Route {
  return {
    method: "PUT",
    path: pluginPreferencesPathPattern,
    handle: ({ response, parameters, body }) => {
      const pluginKey = parameters["key"] ?? "";

      if (!options.plugins.statuses().some((status) => status.key === pluginKey)) {
        respondWithError(response, 404, `there is no plugin ${pluginKey}`);

        return;
      }

      const parsed = parsePluginPreferences(body);

      if (parsed.kind === "rejected") {
        respondWithError(response, 400, parsed.diagnostics.join("; "));

        return;
      }

      const written = options.settings.writePluginPreferences(pluginKey, parsed.value);

      if (written.kind !== "written") {
        options.logger.error("the plugin preferences were not written", {
          plugin: pluginKey,
          reason: written.reason,
        });

        // Отказ файла — не ошибка запроса и не поломка демона: настройки на диске правил кто-то
        // ещё, и разобраться с этим может только человек. Отказ файловой системы (`500`) — тоже его
        // дело, поэтому причина уходит в ответ, а не остаётся в журнале.
        respondWithError(response, written.kind === "refused" ? 409 : 500, written.reason);

        return;
      }

      // В ответе нет состояния плагинов: подъём идёт своим чередом, и снимок этого момента назвал бы
      // прежнее состояние, споря с переходами, которые клиент уже получил потоком.
      const updated: PluginPreferencesUpdated = { key: pluginKey, preferences: parsed.value };

      respondWithJson(response, 200, updated);
    },
  };
}
