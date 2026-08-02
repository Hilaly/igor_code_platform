/**
 * Листинг файловой системы для проводника выбора папки проекта (docs/web-api.md). Контракт лежит
 * здесь, а не в демоне, по той же причине, что и остальные: и сервер, и клиент читают эти типы, и
 * расхождение ловится компилятором.
 *
 * Сам проводник — примитив кита (`FilePicker`): он рисует то, что приехало в `entries`, и ничего не
 * знает ни про `readdir`, ни про права. Этот модуль — форма ответа маршрута листинга.
 */

/** Путь маршрута листинга. Параметр `path` — абсолютный путь открываемого каталога. */
export const filesystemPath = "/api/filesystem";

/** Имя query-параметра с абсолютным путём каталога. */
export const filesystemQueryParameter = "path";

export type FilesystemEntry = {
  name: string;
  kind: "file" | "directory";
};

export type FilesystemListing = {
  /** Абсолютный путь каталога, чей листинг приехал. Тот же, что в запросе, — для ровного возврата. */
  path: string;
  entries: FilesystemEntry[];
};

/**
 * Разобрать query-параметр пути. Возвращает путь или `undefined`, если параметра нет или он пуст:
 * маршрут листинга без пути бесмысслен, и обработчик отвечает 400, а не выдумывает корень.
 */
export function parseFilesystemQuery(raw: string | null): string | undefined {
  if (raw === null) {
    return undefined;
  }

  const trimmed = raw.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}
