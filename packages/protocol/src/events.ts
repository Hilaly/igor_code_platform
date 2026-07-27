/**
 * События шины, которые публикует ядро (ADR-0012). Неймспейс `core` принадлежит ядру, и занять его
 * плагин не может (ADR-0060): иначе подписчик перестал бы отличать сообщение платформы от
 * сообщения плагина.
 *
 * Тип события и его нагрузка описаны рядом: подписчик в браузере обязан разбирать ровно то, что
 * опубликовал демон, и проверить это должен компилятор, а не человек.
 */

import type { ContributionRegistration } from "./contribution.ts";
import type { PluginStatus } from "./plugin-lifecycle.ts";
import type { PluginSource } from "./plugin.ts";

/** Неймспейс ядра. Плагин занять его не может: иначе его событие неотличимо от платформенного. */
export const coreEventNamespace = "core";

/**
 * Записи журнала здесь нет намеренно: журнал не событие предметной области и на шину не публикуется
 * (ADR-0074). Его единственный получатель — `stdout`.
 */
export const coreEventTypes = {
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
  "core.plugin.lifecycle": PluginStatus;
  "core.plugin.contributions": PluginContributionsChanged;
};

export type CoreEventType = keyof CoreEventPayloads;

/** Размеченное объединение: тип события определяет форму нагрузки. */
export type CoreEvent = {
  [Type in CoreEventType]: { type: Type; payload: CoreEventPayloads[Type] };
}[CoreEventType];

/**
 * Кто опубликовал. Подписчик обязан это знать: контракт события принадлежит автору, и без имени
 * расхождение «форма нагрузки изменилась» не на кого повесить (ADR-0072).
 */
export type PluginEventOrigin = {
  /** Ключ экземпляра: идентичность вместе с источником (ADR-0067). */
  key: string;
  id: string;
  source: PluginSource;
};

/**
 * Событие плагина. Перечислить их типы заранее нельзя — плагин не входит в поставку, — поэтому
 * форма одна на все: имя строкой, нагрузка непрозрачная. Проверил её тот, кто опубликовал
 * (ADR-0072).
 */
export type PluginBusEvent = {
  /** Полное имя, с неймспейсом публикатора: `<pluginId>.<объявленное>`. */
  type: string;
  payload: unknown;
  plugin: PluginEventOrigin;
};

/**
 * Всё, что ходит по шине. Различаются формы наличием `plugin`, а не полем-меткой: объединение
 * событий ядра остаётся закрытым, и нагрузка события ядра не деградирует до `unknown`.
 */
export type BusEvent = CoreEvent | PluginBusEvent;

export function isPluginBusEvent(event: BusEvent): event is PluginBusEvent {
  return "plugin" in event;
}
