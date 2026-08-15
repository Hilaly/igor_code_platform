/**
 * Распаковка встроенных плагинов из нагрузки артефакта (docs/toolchain.md). Артефакт — один файл, но
 * плагину нужен диск: его воркер это отдельный поток со своим разрешением модулей, и файл из памяти
 * ему подсунуть нечем.
 *
 * Каталог версии появляется целиком или не появляется: содержимое пишется рядом, во временный
 * каталог, и встаёт на место переименованием. Оборванная распаковка не имеет права оставить каталог,
 * который следующий старт сочтёт готовым, — иначе половина плагинов отказалась бы стартовать без
 * единого способа это починить, кроме удаления папки руками.
 *
 * Готовность отмечает штамп с отпечатком нагрузки. Одной версии платформы мало: между двумя сборками
 * артефакта она не меняется, и по версии вторая сборка молча работала бы с содержимым первой. Он же
 * и есть обещание «правки внутри `builtin/` затираются обновлением» (docs/data-directory.md).
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { PayloadFiles } from "./artifact-payload.ts";
import type { Logger } from "./logger.ts";

export const builtinDirectoryName = "builtin";

/** Штамп лежит внутри каталога версии: он появляется и исчезает вместе с распакованным. */
export const builtinStampFileName = ".sovereign-builtin";

export type UnpackBuiltinPluginsOptions = {
  dataDirectory: string;
  /** Версия платформы: каталог версии переживает обновление артефакта, прошлые удаляются. */
  version: string;
  /** Отпечаток нагрузки: он отличает две сборки одной версии платформы. */
  digest: string;
  files: PayloadFiles;
  logger: Logger;
};

/**
 * Корень встроенных плагинов на диске. Его же получает обход плагинов: дальше распакованный каталог
 * ничем не отличается от `plugins/` репозитория.
 */
export function unpackBuiltinPlugins(options: UnpackBuiltinPluginsOptions): string {
  const root = join(options.dataDirectory, builtinDirectoryName);
  const directory = join(root, options.version);

  mkdirSync(root, { recursive: true });

  if (readStamp(directory) === options.digest) {
    forgetEverythingElse(root, options.version, options.logger);

    return directory;
  }

  // Временный каталог рядом, а не в системном tmp: `rename` между файловыми системами не работает,
  // а директория данных вполне может лежать не там, где `/tmp`.
  const staging = mkdtempSync(join(root, `.${options.version}.incoming-`));

  try {
    for (const [path, bytes] of options.files) {
      const target = join(staging, ...path.split("/"));

      mkdirSync(dirname(target), { recursive: true });
      // Пофайловая атомарность здесь не нужна и вредна: на место встаёт каталог целиком, а лишний
      // временный файл рядом с каждым исходником пришлось бы ещё и убирать.
      writeFileSync(target, bytes);
    }

    writeFileSync(join(staging, builtinStampFileName), `${options.digest}\n`);

    // Прошлое сносится до переименования: `rename` на непустой каталог не встаёт. Окно, в котором
    // каталога версии нет вовсе, безопасно — распаковка идёт под локом и до первого обхода плагинов,
    // а обрыв в нём приводит ровно к повторной распаковке на следующем старте.
    rmSync(directory, { recursive: true, force: true });
    renameSync(staging, directory);
  } catch (cause) {
    rmSync(staging, { recursive: true, force: true });

    throw cause;
  }

  options.logger.info("the builtin plugins are unpacked", {
    directory,
    digest: options.digest,
    files: options.files.size,
  });

  forgetEverythingElse(root, options.version, options.logger);

  return directory;
}

function readStamp(directory: string): string | undefined {
  try {
    return readFileSync(join(directory, builtinStampFileName), "utf8").trim();
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }

    throw cause;
  }
}

/**
 * Каталоги прошлых версий и брошенные временные. И то и другое — мегабайты, которые больше никому не
 * нужны: без уборки директория данных росла бы на каждое обновление артефакта и на каждый обрыв.
 */
function forgetEverythingElse(root: string, version: string, logger: Logger): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === version) {
      continue;
    }

    try {
      rmSync(join(root, entry.name), { recursive: true, force: true });
    } catch (cause) {
      // Не удалить чужой каталог — не повод не запускаться: место занято, работа продолжается.
      logger.warn("a builtin directory of a past version could not be removed", {
        directory: join(root, entry.name),
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}
