/**
 * Записи субагентов поверх хранилища плагина (docs/subagents.md).
 *
 * Память воркера теряется при перезагрузке плагина, а субагент к этому моменту может ещё работать,
 * поэтому запись живёт в `storage`, а не в переменной модуля. Отдельного индекса нет: ключ несёт
 * идентификатор сессии, и список собирается перебором `storage.keys()` по префиксу.
 */

import { storage, type ThinkingLevel } from "@sovereign/sdk";

import type { SubagentState } from "./state.ts";

export type SubagentRecord = {
  sessionId: string;
  /** Сессия, из инструмента которой субагент запущен: по ней собирается её список субагентов. */
  parentSessionId: string;
  projectId: string;
  agentId: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  /** Короткая подпись от вызывающего: она же строка списка в панели. */
  description: string;
  /** Задание, с которого субагент начал. */
  prompt: string;
  state: SubagentState;
  startedAt: string;
  finishedAt?: string;
  /** Текст последнего сообщения агента: то, ради чего субагента и звали. */
  lastResponse?: string;
  /** Почему работа не удалась. Есть только у `failed`. */
  failure?: string;
};

const keyPrefix = "subagent.";

/**
 * Ключ начинается с буквы, а не с идентификатора сессии: по префиксу видно, что в хранилище плагина
 * лежит именно запись субагента, и рядом можно завести ключ другого назначения.
 */
export function recordKey(sessionId: string): string {
  return `${keyPrefix}${sessionId}`;
}

export async function readRecord(sessionId: string): Promise<SubagentRecord | undefined> {
  return asRecord(await storage.get(recordKey(sessionId)));
}

export async function writeRecord(record: SubagentRecord): Promise<void> {
  await storage.set(recordKey(record.sessionId), record);
}

export async function removeRecord(sessionId: string): Promise<void> {
  await storage.delete(recordKey(sessionId));
}

/** Все записи, новые сверху. Битую запись пропускаем: одна такая не отменяет остальные. */
export async function listRecords(): Promise<SubagentRecord[]> {
  const keys = (await storage.keys()).filter((key) => key.startsWith(keyPrefix));
  const records = await Promise.all(keys.map(async (key) => asRecord(await storage.get(key))));

  return records
    .filter((record): record is SubagentRecord => record !== undefined)
    .sort((left, right) => (left.startedAt < right.startedAt ? 1 : -1));
}

/**
 * Значение из хранилища приезжает через структурное клонирование и типом не проверено, поэтому
 * форма сверяется здесь. Непохожее на запись значение — не ошибка платформы: его мог положить туда
 * прежний, несовместимый выпуск плагина.
 */
function asRecord(value: unknown): SubagentRecord | undefined {
  const candidate = (value ?? {}) as Partial<SubagentRecord>;

  return typeof candidate.sessionId === "string" &&
    typeof candidate.parentSessionId === "string" &&
    typeof candidate.state === "string"
    ? (candidate as SubagentRecord)
    : undefined;
}
