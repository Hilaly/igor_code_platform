/**
 * Директория данных (docs/data-directory.md): всё состояние платформы лежит внутри неё, за её пределы никто не
 * пишет. Путь приходит аргументом запуска, поэтому его надо развернуть и создать при отсутствии.
 */

import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Разворот `~` делаем сами: значение по умолчанию `~/.sovereign_platform` попадает в путь как
 * есть, а оболочка тильду не подставит — аргумент может прийти и не из неё.
 */
export function resolveDataDirectory(path: string, home: string = homedir()): string {
  const expanded = path === "~" || path.startsWith("~/") ? join(home, path.slice(1)) : path;

  return resolve(expanded);
}

/** Папка плагинов создаётся вместе с директорией данных: класть плагин человеку некуда иначе. */
export const pluginsDirectoryName = "plugins";

/**
 * Папка эфемерного проекта (docs/sessions-and-projects.md). Создаётся здесь же и по той же причине:
 * эфемерный проект есть всегда, а «есть всегда» без папки на диске значит «первая же сессия в нём
 * падает». Записи о нём в `projects.json` нет — что слово «эфемерный» и значит.
 */
export const workDirectoryName = "work";

/**
 * Папка записей сессий агента (docs/data-directory.md). Создаётся при старте: агентный рантайм
 * пишет в неё сам, а корень, которого нет, он не заводит.
 */
export const sessionsDirectoryName = "sessions";

/**
 * Корень архивных сессий — **сосед** `sessions/`, а не папка внутри неё. Архивация переносит файл
 * между корнями, и вложенная папка сломала бы обход рантайма: он берёт папки первого уровня корня
 * за папки рабочих директорий (docs/sessions-and-projects.md).
 */
export const archivedSessionsDirectoryName = "sessions-archived";

/**
 * Хранилища плагинов: ключ-значение по файлу на плагин и папка на плагин (docs/plugins.md). Имя
 * внутри — ключ плагина `<источник>:<id>` с `%3A` вместо двоеточия: двоеточие в имени файла
 * незаконно на Windows, а идентификаторы плагина и проекта состоят из `[a-z0-9-]`, поэтому
 * кодировать больше нечего и кодирование обратимо.
 *
 * Оба корня создаются по надобности, а не при старте: класть в них человеку нечего — пишет туда
 * платформа.
 */
export const pluginStorageDirectoryName = "plugin-storage";

export const pluginFilesDirectoryName = "plugin-files";

export function ensureDataDirectory(path: string): string {
  const directory = resolveDataDirectory(path);
  const existing = statSync(directory, { throwIfNoEntry: false });

  if (existing !== undefined && !existing.isDirectory()) {
    throw new Error(`The data directory path is taken by a file: ${directory}`);
  }

  mkdirSync(join(directory, pluginsDirectoryName), { recursive: true });
  mkdirSync(join(directory, workDirectoryName), { recursive: true });
  mkdirSync(join(directory, sessionsDirectoryName), { recursive: true });
  mkdirSync(join(directory, archivedSessionsDirectoryName), { recursive: true });

  return directory;
}
