/**
 * Внешний вид и локаль через веб-API. Маршрут не хранит своего состояния: читает снимок настроек,
 * пишет `preferences.json` и перечитывает его — тот же путь, которым идёт правка файла руками
 * (docs/data-directory.md).
 *
 * Здесь же публикация `core.preferences.changed`: файл перечитывается на живом демоне, и правка
 * руками обязана доезжать до открытого браузера. Нагрузки у события нет — состояние спрашивается у
 * владельца, то есть этим же маршрутом (docs/event-bus.md).
 */

import {
  coreEventTypes,
  parseAppearancePreferences,
  preferencesPath,
  type AppearancePreferences,
} from "@sovereign/protocol";

import { respondWithError, respondWithJson, type Route } from "./dispatcher.ts";
import type { EventBus } from "./event-bus.ts";
import type { Logger } from "./logger.ts";
import type { SettingsSnapshot, SettingsStore } from "./settings.ts";

export type AppearancePreferencesRouteOptions = {
  settings: Pick<SettingsStore, "current" | "writeAppearancePreferences">;
  logger: Logger;
};

export function appearancePreferencesRoutes(options: AppearancePreferencesRouteOptions): Route[] {
  return [
    {
      method: "GET",
      path: preferencesPath,
      handle: ({ response }) =>
        respondWithJson(response, 200, appearanceOf(options.settings.current())),
    },
    {
      method: "PUT",
      path: preferencesPath,
      handle: ({ response, body }) => {
        const parsed = parseAppearancePreferences(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        const written = options.settings.writeAppearancePreferences(parsed.value);

        if (written.kind === "refused") {
          options.logger.error("the appearance preferences were not written", {
            reason: written.reason,
          });

          // Отказ файла — не ошибка запроса и не поломка демона: настройки на диске правил кто-то
          // ещё, и разобраться с этим может только человек.
          respondWithError(response, 409, written.reason);

          return;
        }

        respondWithJson(response, 200, parsed.value);
      },
    },
  ];
}

export type PublishAppearanceChangesOptions = {
  settings: Pick<SettingsStore, "current" | "subscribe">;
  bus: Pick<EventBus, "publish">;
};

/**
 * Событие уходит только тогда, когда изменился именно этот раздел: о записях плагинов из того же
 * файла рассказывают переходы жизненного цикла и смена набора вкладов.
 *
 * Возвращает функцию отписки.
 */
export function publishAppearanceChanges(options: PublishAppearanceChangesOptions): () => void {
  // Сравнение сериализацией законно: раздел собираем мы сами, порядок ключей в нём детерминирован.
  let published = JSON.stringify(appearanceOf(options.settings.current()));

  return options.settings.subscribe((snapshot) => {
    const next = JSON.stringify(appearanceOf(snapshot));

    if (next === published) {
      return;
    }

    published = next;
    options.bus.publish(coreEventTypes.preferencesChanged, {});
  });
}

function appearanceOf(snapshot: SettingsSnapshot): AppearancePreferences {
  return {
    appearance: snapshot.preferences.appearance,
    locale: snapshot.preferences.locale,
  };
}
