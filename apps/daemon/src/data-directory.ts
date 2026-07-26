/**
 * Директория данных (ADR-0008): всё состояние платформы лежит внутри неё, за её пределы никто не
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

export function ensureDataDirectory(path: string): string {
  const directory = resolveDataDirectory(path);
  const existing = statSync(directory, { throwIfNoEntry: false });

  if (existing !== undefined && !existing.isDirectory()) {
    throw new Error(`The data directory path is taken by a file: ${directory}`);
  }

  mkdirSync(directory, { recursive: true });

  return directory;
}
