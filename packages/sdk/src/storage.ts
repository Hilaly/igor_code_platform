/**
 * Хранилище плагина (docs/plugins.md): ключ-значение и своя папка. Файл пишет ядро, поэтому
 * атомарность записи и одновременный доступ — забота платформы, а не автора плагина.
 *
 * Третий вид запроса в паре «воркер спрашивает ядро», рядом с провайдерами и сессиями. Новой пары
 * сообщений он не заводит: корреляция и ответ висящим запросам при смерти воркера у пары уже есть.
 * Правило «вид запроса — закрытое объединение, а не произвольное имя метода» действует и здесь.
 *
 * **Ключ плагина в запрос не входит.** Его проставляет ядро по идентичности воркера — тем же
 * приёмом, каким проставляется источник записи журнала и неймспейс события: спросить чужое
 * хранилище нечем.
 */

import { currentPluginHost } from "./host.ts";

export type StorageRequest =
  | { kind: "storage-get"; key: string }
  | { kind: "storage-set"; key: string; value: unknown }
  | { kind: "storage-delete"; key: string }
  | { kind: "storage-keys" }
  | { kind: "storage-directory" };

export type StorageResponse =
  /** Значения нет — поля нет: `undefined` через структурное клонирование не отличить от «не клали». */
  | { kind: "storage-value"; value?: unknown }
  | { kind: "storage-written" }
  | { kind: "storage-keys"; keys: string[] }
  | { kind: "storage-directory"; path: string }
  | { kind: "failed"; reason: string };

async function ask<Kind extends Exclude<StorageResponse["kind"], "failed">>(
  request: StorageRequest,
  expected: Kind,
): Promise<Extract<StorageResponse, { kind: Kind }>> {
  const response = await currentPluginHost().storage(request);

  if (response.kind === "failed") {
    throw new Error(response.reason);
  }

  if (response.kind !== expected) {
    throw new Error(`the platform answered ${response.kind} to a ${expected} request`);
  }

  return response as Extract<StorageResponse, { kind: Kind }>;
}

export const storage = {
  /** Значение по ключу. `undefined` — не клали или удалили: разницы между ними здесь нет. */
  get: async (key: string): Promise<unknown> =>
    (await ask({ kind: "storage-get", key }, "storage-value")).value,

  /**
   * Записать значение. Ответ есть у записи тоже, и это не украшение: отказ файловой системы обязан
   * доехать до того, кто писал, — иначе платформа теряет настройку молча.
   */
  set: async (key: string, value: unknown): Promise<void> => {
    await ask({ kind: "storage-set", key, value }, "storage-written");
  },

  /** Удалить ключ. Удаление того, чего нет, — не ошибка. */
  delete: async (key: string): Promise<void> => {
    await ask({ kind: "storage-delete", key }, "storage-written");
  },

  /** Все ключи хранилища этого плагина, по алфавиту. */
  keys: async (): Promise<string[]> => (await ask({ kind: "storage-keys" }, "storage-keys")).keys,

  /**
   * Абсолютный путь своей папки внутри директории данных; к возврату папка уже создана. Что в ней
   * лежит — дело плагина: вложения, кэш, своя база под свою ответственность.
   */
  directory: async (): Promise<string> =>
    (await ask({ kind: "storage-directory" }, "storage-directory")).path,
};
