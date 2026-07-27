/**
 * Хот-релоад плагинов: правка исходников поднимает плагин заново, появление и исчезновение папки
 * переобнаруживает источник. Наблюдение рекурсивное по корню каждого источника — по одному
 * наблюдателю на корень, а не на плагин: наблюдатель встаёт не мгновенно, и чем их больше в одном
 * всплеске, тем шире окно потерянных событий ([runtime-checks.md](../../../docs/runtime-checks.md),
 * проверка 14).
 *
 * `node_modules` и `package-lock.json` исключены: установка зависимостей пишет и туда, и туда, а
 * перезагрузка на её события запустила бы установку заново по кругу (ADR-0042, проверка 17).
 */

import { statSync, watch, type FSWatcher } from "node:fs";
import { join, sep } from "node:path";

import type { Logger } from "./logger.ts";
import type { PluginRoot } from "./plugin-sources.ts";

export type PluginWatcher = {
  /** Возвращает управление, когда наблюдатели поставлены; читать надо после этого (проверка 14). */
  start: () => void;
  close: () => void;
};

export type CreatePluginWatcherOptions = {
  roots: PluginRoot[];
  logger: Logger;
  /** Папки плагинов, в которых что-то изменилось. Пустой набор значит «изменился сам корень». */
  onChange: (changedDirectories: string[]) => void;
  debounceMilliseconds?: number;
};

/** Крупнее, чем у настроек: редактор пишет пачкой, а перезапуск плагина дороже перечитывания файла. */
const defaultDebounceMilliseconds = 150;

const ignoredNames = new Set(["node_modules", "package-lock.json", ".DS_Store"]);

export function createPluginWatcher(options: CreatePluginWatcherOptions): PluginWatcher {
  const { roots, logger, onChange } = options;
  const debounceMilliseconds = options.debounceMilliseconds ?? defaultDebounceMilliseconds;

  const watchers: FSWatcher[] = [];
  const changed = new Set<string>();

  let debounceTimer: NodeJS.Timeout | undefined;
  let armedAt = 0;

  const note = (root: PluginRoot, relative: string): void => {
    const segments = relative.split(sep).filter((segment) => segment.length > 0);

    if (segments.some((segment) => ignoredNames.has(segment))) {
      return;
    }

    const first = segments[0];

    // Первое событие после постановки наблюдателя приходит пачкой на всё поддерево — со всеми
    // папками и всеми давно лежащими файлами (проверка 17). Правкой считается только то, что
    // изменилось после постановки: папка сама по себе правкой не является, файл старше наблюдателя
    // — тоже. Исчезнувший путь считается правкой: так выглядит удаление.
    const entry = statSync(join(root.directory, relative), { throwIfNoEntry: false });
    const edited = entry === undefined || (!entry.isDirectory() && entry.mtimeMs >= armedAt);

    // Событие о самой папке плагина (создание, удаление, переименование) приходит с одним
    // сегментом — там менять нечего, переобнаружение покажет и появление, и исчезновение.
    if (first !== undefined && segments.length > 1 && edited) {
      changed.add(join(root.directory, first));
    }

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      const directories = [...changed];
      changed.clear();
      debounceTimer = undefined;

      onChange(directories);
    }, debounceMilliseconds);
  };

  return {
    start: () => {
      armedAt = Date.now();

      for (const root of roots) {
        try {
          // Событие без имени возможно: тогда известно только, что в корне что-то было, и это
          // повод переобнаружить источник, а не перезагружать плагины.
          const watcher = watch(root.directory, { recursive: true }, (_event, name) => {
            note(root, typeof name === "string" ? name : "");
          });

          // Ошибка наблюдателя не глушится: без него плагины молча перестают перезагружаться.
          watcher.on("error", (cause: Error) => {
            logger.error("the plugin watcher failed", {
              directory: root.directory,
              reason: cause.message,
            });
          });

          watchers.push(watcher);
        } catch (cause) {
          if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
            // Корня может не быть: встроенных плагинов в сборке может не оказаться вовсе.
            logger.debug("the plugin source root is missing and is not watched", {
              directory: root.directory,
            });

            continue;
          }

          throw cause;
        }
      }
    },
    close: () => {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }

      for (const watcher of watchers) {
        watcher.close();
      }

      watchers.length = 0;
    },
  };
}
