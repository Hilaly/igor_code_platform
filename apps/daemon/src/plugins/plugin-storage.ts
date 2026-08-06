/**
 * Хранилище плагина (docs/plugins.md): ключ-значение файлом и своя папка. Пишет ядро, поэтому
 * атомарность записи и одновременный доступ — забота платформы, а не автора плагина.
 *
 * **Ключ хранилища — источник плюс идентификатор**, а не только идентификатор: перекрытие плагина —
 * это другой плагин, и черновик из папки проекта не имеет права работать с боевыми данными
 * встроенного. Ключ приходит от супервизора по идентичности воркера — в запросе его нет вовсе,
 * поэтому спросить чужое хранилище нечем.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { StorageRequest, StorageResponse } from "@sovereign/sdk";

import type { ContributingPlugin } from "./contribution-registry.ts";
import {
  pluginFilesDirectoryName,
  pluginStorageDirectoryName,
  writeFileAtomically,
  type Logger,
} from "../platform/public.ts";

/**
 * Ключ длиной с имя файла и без сюрпризов файловой системы. Точка внутри разрешена, ведущая — нет:
 * скрытый файл здесь ни к чему, а ключ читается человеком в json.
 */
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type PluginStorage = {
  answer: (plugin: ContributingPlugin, request: StorageRequest) => Promise<StorageResponse>;
  /**
   * Убрать хранилища плагинов из папки удалённого проекта. Обязанность названа в docs/plugins.md:
   * иначе директория данных копит состояние плагинов из папок, которых больше нет.
   */
  removeProject: (projectId: string) => void;
};

export type CreatePluginStorageOptions = {
  /** Директория данных целиком: оба корня — её подпапки (docs/data-directory.md). */
  directory: string;
  logger: Logger;
};

type StoredDocument = { values: Record<string, unknown> };

/**
 * Двоеточие ключа в имени файла незаконно на Windows, поэтому кодируется — тем же `%3A`, каким
 * ключ уже кодируется в маршруте `PUT /api/plugins/:key/preferences` (docs/web-api.md). Больше
 * кодировать нечего: и идентификатор плагина, и идентификатор проекта — это `[a-z0-9-]`.
 */
export function encodePluginKey(pluginKey: string): string {
  return pluginKey.replaceAll(":", "%3A");
}

export function createPluginStorage(options: CreatePluginStorageOptions): PluginStorage {
  const { directory, logger } = options;
  const storageRoot = join(directory, pluginStorageDirectoryName);
  const filesRoot = join(directory, pluginFilesDirectoryName);

  const documentPath = (pluginKey: string): string =>
    join(storageRoot, `${encodePluginKey(pluginKey)}.json`);

  const folderPath = (pluginKey: string): string => join(filesRoot, encodePluginKey(pluginKey));

  /**
   * Читает документ для правки. Негодный файл — отказ, а не пустой документ: под ним состояние
   * плагина, которого больше нигде нет, и запись поверх стёрла бы его молча (docs/data-directory.md).
   */
  const read = (pluginKey: string): { kind: "read"; document: StoredDocument } | StorageFailure => {
    let raw: string;

    try {
      raw = readFileSync(documentPath(pluginKey), "utf8");
    } catch (cause) {
      if ((cause as { code?: unknown }).code === "ENOENT") {
        return { kind: "read", document: { values: {} } };
      }

      return failure(`the storage of ${pluginKey} cannot be read: ${describe(cause)}`);
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      // Причина уходит и в журнал: плагин увидит отказ, а починит файл человек, и без записи он не
      // узнает о ней вовсе — журнал наружу не отдаётся (docs/logging.md).
      logger.error("the storage file of the plugin is not valid json and was not overwritten", {
        plugin: pluginKey,
        reason: describe(cause),
      });

      return failure(`the storage of ${pluginKey} is not valid json: ${describe(cause)}`);
    }

    const values = (parsed as { values?: unknown } | null)?.values;

    if (typeof values !== "object" || values === null || Array.isArray(values)) {
      logger.error("the storage file of the plugin has no values object and was not overwritten", {
        plugin: pluginKey,
      });

      return failure(`the storage of ${pluginKey} has no values object`);
    }

    return { kind: "read", document: { values: values as Record<string, unknown> } };
  };

  const write = (pluginKey: string, document: StoredDocument): StorageResponse => {
    try {
      mkdirSync(storageRoot, { recursive: true });
      writeFileAtomically(documentPath(pluginKey), `${JSON.stringify(document, undefined, 2)}\n`);
    } catch (cause) {
      return failure(`the storage of ${pluginKey} cannot be written: ${describe(cause)}`);
    }

    return { kind: "storage-written" };
  };

  return {
    answer: async (plugin, request) => {
      const pluginKey = plugin.key;

      if ("key" in request && !keyPattern.test(request.key)) {
        return failure(
          `the storage key ${JSON.stringify(request.key)} must match ${keyPattern.source}`,
        );
      }

      if (request.kind === "storage-directory") {
        try {
          const path = folderPath(pluginKey);
          mkdirSync(path, { recursive: true });

          return { kind: "storage-directory", path };
        } catch (cause) {
          return failure(`the folder of ${pluginKey} cannot be created: ${describe(cause)}`);
        }
      }

      const stored = read(pluginKey);

      if (stored.kind === "failed") {
        return stored;
      }

      const { values } = stored.document;

      switch (request.kind) {
        case "storage-get":
          // Поля нет, если значения нет: `undefined` структурное клонирование не отличает от
          // «не клали», и плагин обязан видеть одно и то же в обоих случаях.
          return Object.hasOwn(values, request.key)
            ? { kind: "storage-value", value: values[request.key] }
            : { kind: "storage-value" };
        case "storage-keys":
          return { kind: "storage-keys", keys: Object.keys(values).sort() };
        case "storage-set": {
          // Проверка до записи, а не после: значение с циклом или `bigint` уронило бы запись уже
          // после того, как остальные ключи ушли бы в сериализацию.
          try {
            if (!isJsonValue(request.value)) {
              return failure(
                `the value of ${request.key} is not json for ${pluginKey}: unsupported value`,
              );
            }
          } catch (cause) {
            return failure(
              `the value of ${request.key} is not json for ${pluginKey}: ${describe(cause)}`,
            );
          }

          return write(pluginKey, { values: { ...values, [request.key]: request.value } });
        }
        case "storage-delete": {
          if (!Object.hasOwn(values, request.key)) {
            // Удаление того, чего нет, — не ошибка и не повод трогать файл.
            return { kind: "storage-written" };
          }

          const rest = { ...values };
          delete rest[request.key];

          return write(pluginKey, { values: rest });
        }
      }
    },
    removeProject: (projectId) => {
      const prefix = `${encodePluginKey(`project:${projectId}:`)}`;

      for (const name of listing(storageRoot)) {
        if (name.startsWith(prefix) && name.endsWith(".json")) {
          remove(() => unlinkSync(join(storageRoot, name)), name);
        }
      }

      for (const name of listing(filesRoot)) {
        if (name.startsWith(prefix)) {
          remove(() => rmSync(join(filesRoot, name), { recursive: true, force: true }), name);
        }
      }
    },
  };

  function listing(root: string): string[] {
    try {
      return readdirSync(root);
    } catch (cause) {
      if ((cause as { code?: unknown }).code === "ENOENT") {
        return [];
      }

      logger.warn("the plugin storage root cannot be listed", {
        directory: root,
        reason: describe(cause),
      });

      return [];
    }
  }

  function remove(erase: () => void, name: string): void {
    try {
      erase();
      logger.info("the storage of a plugin from a deleted project is gone", { entry: name });
    } catch (cause) {
      // Уборка остатков — обязанность реализации, а не «этого не случится» (docs/data-directory.md):
      // неудача записывается, а не глотается, иначе остаток исчезает из виду вместе с ошибкой.
      logger.warn("the storage of a plugin from a deleted project could not be removed", {
        entry: name,
        reason: describe(cause),
      });
    }
  }
}

type StorageFailure = Extract<StorageResponse, { kind: "failed" }>;

function failure(reason: string): StorageFailure {
  return { kind: "failed", reason };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object") {
    return false;
  }

  if (ancestors.has(value)) {
    return false;
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);

  if (!array && prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  ancestors.add(value);

  try {
    if (array) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index) || !isJsonValue(value[index], ancestors)) {
          return false;
        }
      }

      return true;
    }

    return Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

/** Виды запроса не пересекаются по построению: у хранилища они начинаются с `storage-`. */
export function isStorageRequest(request: { kind: string }): request is StorageRequest {
  return request.kind.startsWith("storage-");
}
