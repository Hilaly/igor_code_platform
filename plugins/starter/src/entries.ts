/**
 * Данные вызова bash-семейства из записей сессии (спека
 * 2026-08-16-bash-tool-call-visual-design.md). Записи пишутся рантаймом во время турна, поэтому
 * input доступен, как только модель вызвала инструмент, а результат — когда он завершился.
 */

import type { SessionEntriesPage, SessionEntry } from "@sovereign/sdk";

/** Пара «вызов и его результат» из записей сессии. */
export type ToolCallData = {
  input: unknown;
  result?: { text: string; failed: boolean };
};

/**
 * Записи сессии из публичного маршрута (docs/web-api.md). 404 — сессии нет: карточка остаётся без
 * данных, а не падает.
 */
export async function fetchEntries(sessionId: string): Promise<SessionEntriesPage | undefined> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/entries`);
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as SessionEntriesPage;
}

/** Найти вызов по идентификатору: input — из блока сообщения, результат — отдельной записью. */
export function findToolCall(entries: SessionEntry[], toolCallId: string): ToolCallData | undefined {
  let input: unknown | undefined;
  for (const entry of entries) {
    if (entry.kind !== "message") {
      continue;
    }
    for (const block of entry.content) {
      if (block.kind === "tool-call" && block.toolCallId === toolCallId) {
        input = block.input;
      }
    }
  }

  let result: { text: string; failed: boolean } | undefined;
  for (const entry of entries) {
    if (entry.kind === "tool-result" && entry.toolCallId === toolCallId) {
      result = { text: entry.text, failed: entry.failed };
    }
  }

  if (input === undefined && result === undefined) {
    return undefined;
  }
  return { input, ...(result === undefined ? {} : { result }) };
}
