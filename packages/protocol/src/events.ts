/**
 * События шины, которые публикует ядро (ADR-0012). Неймспейс `core` принадлежит ядру, и занять его
 * плагин не может (ADR-0060): иначе подписчик перестал бы отличать сообщение платформы от
 * сообщения плагина.
 *
 * Тип события и его нагрузка описаны рядом: подписчик в браузере обязан разбирать ровно то, что
 * опубликовал демон, и проверить это должен компилятор, а не человек.
 */

import type { ContributionRegistration } from "./contribution.ts";
import type { LogRecord } from "./log.ts";
import type { PluginStatus } from "./plugin-lifecycle.ts";

export const coreEventTypes = {
  /** Каждая запись журнала — событие шины (ADR-0021). */
  log: "core.log",
  /** Переход жизненного цикла плагина (ADR-0018). */
  pluginLifecycle: "core.plugin.lifecycle",
  /** Действующий набор вкладов изменился. */
  pluginContributions: "core.plugin.contributions",
} as const;

/**
 * Не «что изменилось», а «как теперь»: набор отдаётся целиком, потому что подписчик, пропустивший
 * одно событие, при инкрементальном обновлении остался бы с испорченной картиной навсегда.
 */
export type PluginContributionsChanged = {
  /** Ревизия реестра: по ней снимок и поток сверяются, кто из них свежее (ADR-0041). */
  revision: number;
  contributions: ContributionRegistration[];
};

export type CoreEventPayloads = {
  "core.log": LogRecord;
  "core.plugin.lifecycle": PluginStatus;
  "core.plugin.contributions": PluginContributionsChanged;
};

export type CoreEventType = keyof CoreEventPayloads;

/** Размеченное объединение: тип события определяет форму нагрузки. */
export type CoreEvent = {
  [Type in CoreEventType]: { type: Type; payload: CoreEventPayloads[Type] };
}[CoreEventType];
