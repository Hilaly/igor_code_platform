/**
 * Единственное место, где событие плагина попадает на шину и где событие с шины уходит в воркеры
 * (docs/event-bus.md). Отдельно от супервизора, потому что решает оно не про жизнь плагина, а про право
 * публиковать и про то, кому событие интересно.
 *
 * Исключений среди событий ядра нет: доставляется всё, на что подписались (docs/logging.md).
 *
 * Нагрузку здесь никто не проверяет: её проверил воркер публикатора своей схемой. Ядру проверять
 * нечем — схема между воркером и ядром не ходит, ездит только её описание.
 */

import { isPluginBusEvent } from "@sovereign/protocol";

import type { ContributingPlugin, ContributionRegistry } from "./contribution-registry.ts";
import type { EventBus } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";
import type { PluginIncoming } from "./plugin-wire.ts";

export type PluginEvents = {
  /** Имя приходит объявленным: неймспейс ставится здесь, по идентичности воркера. */
  publish: (plugin: ContributingPlugin, declaredId: string, payload: unknown) => void;
  /** Имя, наоборот, полное: подписываются на чужое событие. */
  subscribe: (plugin: ContributingPlugin, type: string) => void;
  unsubscribe: (pluginKey: string, type: string) => void;
  /** Снять все подписки плагина. Зовётся там же, где снимаются его вклады. */
  remove: (pluginKey: string) => void;
  /**
   * Снять подписку на шину, которую заводит этот объект. Сегодня один `PluginEvents` на жизнь
   * демона, но если он будет пересоздан в рантайме или в тесте, старая подписка без этого —
   * живая и доставляет события в дохлые хэндлы воркеров. Симметрично `event-stream.ts`.
   */
  close: () => void;
};

export type CreatePluginEventsOptions = {
  registry: ContributionRegistry;
  bus: EventBus;
  logger: Logger;
  /** Отправка в живой воркер. Плагина без воркера здесь может не быть — это не ошибка. */
  send: (pluginKey: string, message: PluginIncoming) => void;
};

export function createPluginEvents(options: CreatePluginEventsOptions): PluginEvents {
  const { registry, bus, logger, send } = options;

  const subscribers = new Map<string, Set<string>>();

  // Функция отписки хранится и зовётся в close(): иначе пересоздание PluginEvents в рантайме или
  // в тесте оставляет старую подписку живой — она доставляет события в дохлые хэндлы воркеров.
  const unsubscribeBus = bus.subscribe((event) => {
    const listening = subscribers.get(event.type);

    if (listening === undefined) {
      return;
    }

    const message: PluginIncoming = {
      kind: "event",
      type: event.type,
      payload: event.payload,
      ...(isPluginBusEvent(event) ? { plugin: event.plugin } : {}),
    };

    for (const pluginKey of listening) {
      // Плагин, подписанный на своё же событие, получит и его: кольцо разрывает автор, а не
      // платформа. Доставка асинхронна, поэтому демон от этого не встаёт.
      send(pluginKey, message);
    }
  });

  return {
    publish: (plugin, declaredId, payload) => {
      const type = `${plugin.id}.${declaredId}`;

      const declared = registry
        .resolved()
        .some(
          (registration) =>
            registration.kind === "event" &&
            registration.id === type &&
            registration.pluginKey === plugin.key,
        );

      // Недействующее объявление — это выключенный человеком вклад (docs/plugins.md), проигранный спор по
      // источнику (docs/plugins.md) или просто незарегистрированное имя. Для публикации разницы нет: её
      // больше нет. Разница есть для автора, поэтому отказ уходит в журнал, а не в тишину.
      if (!declared) {
        logger.warn("the plugin published an event that is not in effect for it", {
          plugin: plugin.key,
          event: type,
        });

        return;
      }

      bus.publishFromPlugin({
        type,
        payload,
        plugin: { key: plugin.key, id: plugin.id, source: plugin.source },
      });
    },
    subscribe: (plugin, type) => {
      const listening = subscribers.get(type);

      if (listening === undefined) {
        subscribers.set(type, new Set([plugin.key]));
      } else {
        listening.add(plugin.key);
      }
    },
    unsubscribe: (pluginKey, type) => {
      const listening = subscribers.get(type);
      listening?.delete(pluginKey);

      if (listening?.size === 0) {
        subscribers.delete(type);
      }
    },
    remove: (pluginKey) => {
      for (const [type, listening] of [...subscribers]) {
        listening.delete(pluginKey);

        if (listening.size === 0) {
          subscribers.delete(type);
        }
      }
    },
    close: () => {
      subscribers.clear();
      unsubscribeBus();
    },
  };
}
