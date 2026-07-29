/**
 * Кэш динамических списков моделей (docs/data-directory.md). Провайдер с динамическим списком берёт
 * его из сети; без кэша демон ходил бы за ним на каждый старт, а `make dev` перезапускает демон на
 * каждую правку файла.
 *
 * **Политика негодного файла здесь обратная кредам.** Это кэш: испорченный читается как пустой и
 * свободно перезаписывается. Худшая цена ошибки — один лишний сетевой запрос; отказ вместо этого
 * заставил бы человека чинить руками файл, который платформа умеет собрать сама.
 *
 * Значение записи для платформы непрозрачно (`unknown`), как и у кредов: форму знает только
 * `@sovereign/agent-runtime-pi`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomically } from "./atomic-file.ts";
import type { Logger } from "./logger.ts";

export const modelCatalogsFileName = "model-catalogs.json";

export type ModelCatalogStore = {
  read: (providerId: string) => unknown;
  write: (providerId: string, entry: unknown) => void;
  remove: (providerId: string) => void;
};

export type CreateModelCatalogStoreOptions = {
  directory: string;
  logger: Logger;
};

export function createModelCatalogStore(
  options: CreateModelCatalogStoreOptions,
): ModelCatalogStore {
  const path = join(options.directory, modelCatalogsFileName);
  const catalogs = new Map(Object.entries(readCatalogs(path, options.logger)));

  const persist = (): void => {
    writeFileAtomically(
      path,
      `${JSON.stringify({ catalogs: Object.fromEntries(catalogs) }, undefined, 2)}\n`,
    );
  };

  return {
    read: (providerId) => catalogs.get(providerId),
    write: (providerId, entry) => {
      catalogs.set(providerId, entry);
      persist();
    },
    remove: (providerId) => {
      if (catalogs.delete(providerId)) {
        persist();
      }
    },
  };
}

function readCatalogs(path: string, logger: Logger): Record<string, unknown> {
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return {};
    }

    throw cause;
  }

  const forget = (reason: string): Record<string, unknown> => {
    // `warn`, а не `error`: платформа продолжает работать в полную силу, теряется только экономия
    // на сетевом запросе. Молчать всё равно нельзя — файл писала она сама.
    logger.warn("the model catalogue cache was dropped and will be written anew", {
      file: modelCatalogsFileName,
      reason,
    });

    return {};
  };

  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return forget(`not valid json: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const stored =
    typeof document === "object" && document !== null && !Array.isArray(document)
      ? (document as Record<string, unknown>)["catalogs"]
      : undefined;

  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return forget("does not hold a set of catalogues");
  }

  return stored as Record<string, unknown>;
}
