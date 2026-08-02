/**
 * Листинг файловой системы для проводника выбора папки (docs/web-api.md). Один маршрут: каталог по
 * абсолютному пути — в ответе его дети с указанием, файл это или папка.
 *
 * Листинг полон намеренно (решение владельца): пикер показывает всю файловую систему от корня, а не
 * только домашнюю директорию. Скрытые файлы (имя начинается с точки) и `node_modules` отфильтрованы
 * — как у источника плагинов: пользы от них в проводнике нет, а шума и риска — много. Ошибка чтения
 * каталога (нет доступа, нет такого пути) — это 4xx, а не падение демона: пикер покажет её в своей
 * полосе и даст человеку выбрать другой каталог.
 *
 * Маршрут защищён сессией по умолчанию: `access: "open"` здесь не стоит, и листить чужой диск может
 * только вошедший.
 */

import { readdirSync } from "node:fs";

import {
  filesystemPath,
  filesystemQueryParameter,
  parseFilesystemQuery,
  type FilesystemEntry,
  type FilesystemListing,
} from "@sovereign/protocol";

import { respondWithError, respondWithJson, type Route } from "./dispatcher.ts";

export function filesystemRoutes(): Route[] {
  return [
    {
      method: "GET",
      path: filesystemPath,
      handle: ({ response, url }) => {
        const path = parseFilesystemQuery(url.searchParams.get(filesystemQueryParameter));

        if (path === undefined) {
          respondWithError(response, 400, "the path query parameter is required");

          return;
        }

        // К корню запрос приходит как есть; родителя у него нет, и пикер ставит «наверх» неактивной —
        // но листинг корня всё равно нужен.
        const entries = readEntries(path);

        if (entries === undefined) {
          // `readEntries` различает «нет такого пути» и «нет доступа» по коду ошибки — это разные
          // подсказки человеку: одно чинится перебором, другое — правами.
          respondWithError(response, 404, "no such directory");

          return;
        }

        if (entries === null) {
          respondWithError(response, 403, "the directory cannot be read");

          return;
        }

        const body: FilesystemListing = { path, entries };

        respondWithJson(response, 200, body);
      },
    },
  ];
}

/**
 * Дети каталога: каталоги первыми, потом файлы; внутри группы — по имени. `undefined` — пути нет
 * (`ENOENT`/`ENOTDIR`), `null` — нет доступа (`EACCES`/`EPERM`). Скрытые и `node_modules` отфильтрованы.
 */
function readEntries(directory: string): FilesystemEntry[] | undefined | null {
  let entries;

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    const code = (cause as { code?: string } | undefined)?.code;

    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }

    if (code === "EACCES" || code === "EPERM") {
      return null;
    }

    // Чужая ошибка — выше ей нечего делать: лучше ответить 403, чем уронить демон.
    return null;
  }

  return entries
    .filter((entry) => {
      // Символические ссылки считаем каталогами: пройти в них можно, а что внутри — отдельный запрос.
      const navigable = entry.isDirectory() || entry.isSymbolicLink();

      // Файлы тоже показываем — пикер берёт и файл, и папку, и выбрать можно и то и другое. Не
      // директория и не символическая ссылка — регулярный файл.
      const isFile = !navigable;

      return (navigable || isFile) && !entry.name.startsWith(".") && entry.name !== "node_modules";
    })
    .map((entry) => {
      const navigable = entry.isDirectory() || entry.isSymbolicLink();

      return { name: entry.name, kind: navigable ? "directory" : "file" } as FilesystemEntry;
    })
    .sort((a, b) => {
      // Каталоги первыми: в проводнике открываешь папку, а не файл, и она должна быть перед глазами.
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}
