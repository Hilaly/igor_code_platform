/**
 * События шины, которые публикует ядро (ADR-0012). Неймспейс `core` принадлежит ядру, и занять его
 * плагин не может (ADR-0060): иначе подписчик перестал бы отличать сообщение платформы от
 * сообщения плагина.
 *
 * Тип события и его нагрузка описаны рядом: подписчик в браузере обязан разбирать ровно то, что
 * опубликовал демон, и проверить это должен компилятор, а не человек.
 */

import type { LogRecord } from "./log.ts";

export const coreEventTypes = {
  /** Каждая запись журнала — событие шины (ADR-0021). */
  log: "core.log",
} as const;

export type CoreEventPayloads = {
  "core.log": LogRecord;
};

export type CoreEventType = keyof CoreEventPayloads;

/** Размеченное объединение: тип события определяет форму нагрузки. */
export type CoreEvent = {
  [Type in CoreEventType]: { type: Type; payload: CoreEventPayloads[Type] };
}[CoreEventType];
