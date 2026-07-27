/**
 * Поверхность плагина: то, что он импортирует (ADR-0043). Имена импортов — публичный контракт,
 * менять их дороже, чем внутренности.
 *
 * Всё асинхронно (ADR-0011): плагин живёт в своём воркере, и любой вызов к платформе — сообщение.
 */

import { z } from "zod";

import { subscribeToEvent } from "./events.ts";
import { currentPluginHost, type CustomContribution, type PluginLogLevel } from "./host.ts";

export type { EventHandler, EventOrigin, Unsubscribe } from "./events.ts";

export type {
  CustomContribution,
  EventContribution,
  PayloadSchema,
  PluginContribution,
  PluginHost,
  PluginIdentity,
  PluginLogLevel,
} from "./host.ts";

/**
 * Язык схем платформы (ADR-0072). Реэкспорт, а не «поставьте zod сами»: два экземпляра zod в одном
 * процессе дают два несовместимых типа схемы, и схема плагина перестала бы подходить платформе.
 */
export { z };

/**
 * Точки входа плагина. `activate` вызывается после того, как хост готов; `deactivate` — перед
 * выгрузкой, и у него есть только ограниченное время (супервизор не ждёт вечно).
 */
export type PluginModule = {
  activate: () => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

type LogCall = (message: string, fields?: Record<string, unknown>) => Promise<void>;

// Асинхронно и на отсутствии хоста тоже: синхронный бросок из функции, возвращающей обещание,
// прилетел бы автору мимо `catch` вокруг `await`.
const at =
  (level: PluginLogLevel): LogCall =>
  async (message, fields) =>
    currentPluginHost().log(level, message, fields);

/** Источник записи проставляет ядро, а не плагин: подделать чужой нечем (ADR-0021). */
export const log: Record<PluginLogLevel, LogCall> = {
  debug: at("debug"),
  info: at("info"),
  warn: at("warn"),
  error: at("error"),
};

/**
 * Событие плагина: имя, схема нагрузки и способ его опубликовать (ADR-0072).
 *
 * Дескриптор — обычный экспорт модуля, и это главное в нём: подписчик импортирует его у
 * публикатора и получает и типы, и возможность проверить нагрузку у себя. Схема между воркерами не
 * ходит, а исходники — ходят.
 */
export type EventDescriptor<Schema extends z.ZodType = z.ZodType> = {
  /** Объявленный, без неймспейса: неймспейс ставит хост по идентичности плагина. */
  id: string;
  schema: Schema;
  publish: (payload: z.input<Schema>) => Promise<void>;
};

export function defineEvent<Schema extends z.ZodType>(
  id: string,
  schema: Schema,
): EventDescriptor<Schema> {
  return {
    id,
    schema,
    publish: async (payload) => {
      const checked = schema.safeParse(payload);

      // Отказ здесь, у того, кто ошибся, и до отправки: ядро схемы не знает и молча донесло бы
      // несоответствие до подписчика (ADR-0072).
      if (!checked.success) {
        throw new Error(
          `the payload of the event ${id} does not match its schema: ${z.prettifyError(checked.error)}`,
        );
      }

      await currentPluginHost().publishEvent(id, checked.data);
    },
  };
}

export const contribute = {
  /**
   * Общий вид вклада (ADR-0054). Регистрация во время `activate` применяется одним снимком:
   * наблюдатель видит либо прежний набор, либо новый целиком.
   */
  custom: async (contribution: CustomContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "custom", ...contribution }),

  /**
   * Объявить событие. Пока оно не объявлено, публикация отказывается ядром: событие — это вклад, а
   * значит его видно в реестре и его можно выключить (ADR-0032, ADR-0072).
   */
  event: async <Schema extends z.ZodType>(event: EventDescriptor<Schema>): Promise<void> =>
    currentPluginHost().contribute({
      kind: "event",
      id: event.id,
      payloadSchema: { ...z.toJSONSchema(event.schema) },
    }),
};

export const events = {
  /**
   * Слушать чужое событие по полному имени, вместе с неймспейсом публикатора. События ядра
   * слушаются так же, кроме журнала: подписка на `core.log` отказывается (ADR-0073).
   *
   * Возвращает отписку. Пока плагин жив, подписка живёт: снимает её ядро вместе с плагином.
   */
  subscribe: subscribeToEvent,
};

/** Кто мы, по версии хоста. Полезно в логах самого плагина и в его собственных путях. */
export const identity = (): { id: string; source: string } => currentPluginHost().identity;
