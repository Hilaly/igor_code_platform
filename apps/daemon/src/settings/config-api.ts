/**
 * Конфиг демона через веб-API. Маршрут не хранит своего состояния: читает снимок настроек, пишет
 * `config.json` и перечитывает его — тот же путь, которым идёт правка файла руками
 * (docs/data-directory.md). Ничего «применить» после записи не нужно: каждое значение конфига
 * спрашивается у снимка в момент использования, а не при старте (docs/web-api.md).
 *
 * Здесь же публикация `core.config.changed`: файл перечитывается на живом демоне, и правка руками
 * обязана доезжать до открытой формы. Нагрузки у события нет — состояние спрашивается у владельца,
 * то есть этим же маршрутом (docs/event-bus.md).
 */

import { configPath, coreEventTypes, parseConfigUpdate } from "@sovereign/protocol";

import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { EventBus, Logger } from "../platform/public.ts";
import type { SettingsStore } from "./settings.ts";

export type ConfigRouteOptions = {
  settings: Pick<SettingsStore, "current" | "writeConfig">;
  logger: Logger;
};

export function configRoutes(options: ConfigRouteOptions): Route[] {
  return [
    {
      method: "GET",
      path: configPath,
      handle: ({ response }) => respondWithJson(response, 200, options.settings.current().config),
    },
    {
      method: "PUT",
      path: configPath,
      handle: ({ response, body }) => {
        const parsed = parseConfigUpdate(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        const written = options.settings.writeConfig(parsed.value);

        if (written.kind === "refused") {
          options.logger.error("the daemon config was not written", { reason: written.reason });

          // Отказ файла — не ошибка запроса и не поломка демона: конфиг на диске правил кто-то ещё,
          // и разобраться с этим может только человек.
          respondWithError(response, 409, written.reason);

          return;
        }

        respondWithJson(response, 200, parsed.value);
      },
    },
  ];
}

export type PublishConfigChangesOptions = {
  settings: Pick<SettingsStore, "current" | "subscribe">;
  bus: Pick<EventBus, "publish">;
};

/**
 * Событие уходит только тогда, когда изменился именно конфиг: правка `preferences.json` будит того
 * же наблюдателя настроек, но форме конфига сказать о ней нечего.
 *
 * Возвращает функцию отписки.
 */
export function publishConfigChanges(options: PublishConfigChangesOptions): () => void {
  // Сравнение сериализацией законно: снимок собираем мы сами, порядок ключей в нём детерминирован.
  let published = JSON.stringify(options.settings.current().config);

  return options.settings.subscribe((snapshot) => {
    const next = JSON.stringify(snapshot.config);

    if (next === published) {
      return;
    }

    published = next;
    options.bus.publish(coreEventTypes.configChanged, {});
  });
}
