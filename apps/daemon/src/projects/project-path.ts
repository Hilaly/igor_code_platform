/**
 * Нормализация папки проекта до сравнения (docs/sessions-and-projects.md). На один путь приходится
 * ровно один проект, а один и тот же путь пишется десятком способов: `~`, `..`, симлинк, другой
 * регистр, другая форма юникода. Без складки правило «один путь — один проект» обходится случайно.
 *
 * Отсюда два значения: `folder` — путь, каким его показывают человеку, и `folderKey` — то, по чему
 * идёт сравнение. Показывать ключ нельзя: на macOS он понижен в регистре и раскрыт по симлинкам, то
 * есть человек увидел бы не то, что ввёл.
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export type NormalizedProjectPath = {
  folder: string;
  folderKey: string;
};

export type NormalizeProjectPathResult =
  | { kind: "normalized"; value: NormalizedProjectPath }
  /** Путь не годится в папку проекта. Причина показывается человеку. */
  | { kind: "rejected"; reason: string };

export type NormalizeProjectPathOptions = {
  home?: string;
  platform?: NodeJS.Platform;
  /**
   * Разбор симлинков. `realpathSync.native`, а не `realpathSync`: только нативный канонизирует
   * написание на регистронезависимом томе (docs/runtime-checks.md).
   */
  realpath?: (path: string) => string;
};

export type ProjectPathNormalizer = (raw: string) => NormalizeProjectPathResult;

/**
 * Один нормализатор на демон. Складка обязана быть общей: стор считает ключ папки эфемерного
 * проекта, маршрут — ключ создаваемого, и разойдись они хоть в регистре, второй проект встал бы на
 * ту же папку, что первый.
 */
export function createProjectPathNormalizer(
  options: NormalizeProjectPathOptions = {},
): ProjectPathNormalizer {
  return (raw) => normalizeProjectPath(raw, options);
}

export function normalizeProjectPath(
  raw: string,
  options: NormalizeProjectPathOptions = {},
): NormalizeProjectPathResult {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const realpath = options.realpath ?? realpathSync.native;
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { kind: "rejected", reason: "the project folder must not be empty" };
  }

  // `~user` не разворачивается: где живут домашние директории, знает система, а не мы, и угадывание
  // дало бы путь, которого нет.
  if (trimmed.startsWith("~") && trimmed !== "~" && !trimmed.startsWith("~/")) {
    return {
      kind: "rejected",
      reason: `only ~ and ~/ expand to a home directory, got ${JSON.stringify(trimmed)}`,
    };
  }

  const expanded =
    trimmed === "~" || trimmed.startsWith("~/") ? join(home, trimmed.slice(1)) : trimmed;

  // Относительный путь отвергается, а не разворачивается от cwd демона: демон запускается из
  // произвольной директории, и один и тот же «code» означал бы разные папки при разных запусках.
  if (!isAbsolute(expanded)) {
    return {
      kind: "rejected",
      reason: `the project folder must be an absolute path, got ${JSON.stringify(trimmed)}`,
    };
  }

  const folder = resolve(expanded);

  return {
    kind: "normalized",
    value: { folder, folderKey: fold(canonical(folder, realpath), platform) },
  };
}

/**
 * Симлинки снимаются с существующей части пути, а несуществующий хвост приписывается обратно: папка
 * проекта не обязана существовать (docs/sessions-and-projects.md), а `realpath` на несуществующем
 * пути бросает `ENOENT` (docs/runtime-checks.md). Без частичного разбора проект, созданный до
 * появления папки, и проект, созданный после, получили бы разные ключи на одну папку — то есть
 * правило ломалось бы ровно в том случае, ради которого написано.
 */
function canonical(folder: string, realpath: (path: string) => string): string {
  const missing: string[] = [];
  let existing = folder;

  for (;;) {
    try {
      return join(realpath(existing), ...missing.toReversed());
    } catch (cause) {
      const code = (cause as { code?: unknown }).code;

      // Нечитаемый путь — не повод отказать в создании проекта: права могут появиться позже, а ключ
      // нужен сейчас. Лексический путь как ключ хуже разобранного, но он есть.
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return folder;
      }

      const parent = dirname(existing);

      if (parent === existing) {
        return folder;
      }

      missing.push(basename(existing));
      existing = parent;
    }
  }
}

/**
 * Регистр и форму юникода складываем сами, поверх `realpath`, потому что у несуществующей папки
 * написания на диске ещё нет — канонизировать нечего.
 *
 * Признак — платформа, а не проба файловой системы: проба означала бы запись файла в чужую папку,
 * которой может и не быть. Цена известна: регистрозависимый том на macOS и регистронезависимый на
 * linux нам соврут. Это в бэклоге.
 */
function fold(path: string, platform: NodeJS.Platform): string {
  return platform === "darwin" || platform === "win32" ? path.normalize("NFC").toLowerCase() : path;
}
