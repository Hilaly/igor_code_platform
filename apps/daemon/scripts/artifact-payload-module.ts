/**
 * Сборка модуля нагрузки, которым продакшн-сборка подменяет шов
 * `src/platform/artifact-payload.ts` (docs/toolchain.md). Отдельно от самой сборки, потому что это
 * единственная её часть, которую можно проверить, не собирая артефакт целиком: разъехавшаяся с швом
 * форма нагрузки проявилась бы иначе только запуском готового артефакта.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type PayloadContents = {
  /** Вывод сборки фронтенда: путь от корня вывода → байты. */
  web: Map<string, Uint8Array>;
  /** Встроенные плагины: путь от корня встроенных → байты. */
  builtin: Map<string, Uint8Array>;
  /** Собранный бутстрап воркера плагина. */
  worker: Uint8Array;
  /** Зависимости, которые не вшиваются: их поставит `npm` в директорию данных. */
  runtimeDependencies: Record<string, string>;
};

/**
 * Обход каталога целиком. Пути нормализуются к `/` независимо от платформы сборки: они становятся
 * адресами в браузере, а не путями на диске.
 */
export function readDirectoryFiles(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const absolute = join(entry.parentPath, entry.name);

    files.set(relative(root, absolute).split(sep).join("/"), readFileSync(absolute));
  }

  return files;
}

/**
 * Отпечаток нагрузки. Версии платформы для распаковки встроенных плагинов недостаточно: между двумя
 * сборками артефакта она не меняется (docs/toolchain.md).
 */
export function payloadDigest(contents: PayloadContents): string {
  const hash = createHash("sha256");

  // Порядок ключей фиксируется: перестановка в обходе каталога не должна выглядеть сменой нагрузки.
  for (const files of [contents.web, contents.builtin]) {
    for (const path of sortedPaths(files)) {
      hash.update(path);
      hash.update(files.get(path) ?? new Uint8Array());
    }
  }

  hash.update(contents.worker);
  hash.update(JSON.stringify(contents.runtimeDependencies));

  return hash.digest("base64url").slice(0, 16);
}

/**
 * Исходник модуля-замены. Байты едут base64: JS-литерал строки переживает любую кодировку файла, а
 * шрифты и картинки фронтенда — двоичные.
 */
export function payloadModuleSource(contents: PayloadContents): string {
  return `// Сгенерировано сборкой артефакта (apps/daemon/scripts/build-artifact.ts). Не редактировать.
const web = ${fileMapLiteral(contents.web)};

const builtin = ${fileMapLiteral(contents.builtin)};

const worker = ${base64Literal(contents.worker)};

const runtimeDependencies = ${JSON.stringify(contents.runtimeDependencies)};

const digest = ${JSON.stringify(payloadDigest(contents))};

export function artifactPayload() {
  return { web, builtin, worker, runtimeDependencies, digest };
}
`;
}

function fileMapLiteral(files: Map<string, Uint8Array>): string {
  const entries = sortedPaths(files)
    .map(
      (path) =>
        `  [${JSON.stringify(path)}, ${base64Literal(files.get(path) ?? new Uint8Array())}],`,
    )
    .join("\n");

  return `new Map([\n${entries}\n])`;
}

/** Один порядок обхода и у отпечатка, и у литерала: иначе они разошлись бы на пустом месте. */
function sortedPaths(files: Map<string, Uint8Array>): string[] {
  return [...files.keys()].sort();
}

function base64Literal(bytes: Uint8Array): string {
  return `Buffer.from(${JSON.stringify(Buffer.from(bytes).toString("base64"))}, "base64")`;
}
