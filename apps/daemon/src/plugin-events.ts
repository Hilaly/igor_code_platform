/**
 * Единственное место, где событие плагина попадает на шину (ADR-0072). Отдельно от супервизора,
 * потому что решает оно не про жизнь плагина, а про право публиковать: событие — это вклад, и
 * действует оно ровно тогда, когда действует вклад.
 *
 * Нагрузку здесь никто не проверяет: её проверил воркер публикатора своей схемой. Ядру проверять
 * нечем — схема между воркером и ядром не ходит, ездит только её описание.
 */

import type { EventBus } from "./event-bus.ts";
import type { ContributingPlugin, ContributionRegistry } from "./contribution-registry.ts";
import type { Logger } from "./logger.ts";

export type PluginEvents = {
  /** Имя приходит объявленным: неймспейс ставится здесь, по идентичности воркера. */
  publish: (plugin: ContributingPlugin, declaredId: string, payload: unknown) => void;
};

export type CreatePluginEventsOptions = {
  registry: ContributionRegistry;
  bus: EventBus;
  logger: Logger;
};

export function createPluginEvents(options: CreatePluginEventsOptions): PluginEvents {
  const { registry, bus, logger } = options;

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

      // Недействующее объявление — это выключенный человеком вклад (ADR-0032), проигранный спор по
      // источнику (ADR-0040) или просто незарегистрированное имя. Для публикации разницы нет: её
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
  };
}
