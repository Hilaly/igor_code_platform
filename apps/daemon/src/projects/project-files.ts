/**
 * Поиск файлов в папке проекта для подстановки `@файл` в сообщение агенту
 * (docs/sessions-and-projects.md).
 *
 * Свой обход, а не `git ls-files`: папка проекта не обязана быть репозиторием — эфемерный `work`
 * им точно не является, — а зависимость от внешней программы дала бы разное поведение там и здесь.
 * Цена: список исключений зашит в код и не читает `.gitignore`.
 */

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Каталоги, которых в подсказке не бывает. Это не «мусор вообще», а места, где лежит чужое и
 * порождённое: содержимое системы контроля версий, установленные зависимости и результаты сборки.
 * Один такой каталог даёт десятки тысяч путей и делает поиск бесполезным.
 */
const skippedDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".gradle",
  ".idea",
  ".vscode",
]);

export type ProjectFileSearchOptions = {
  /** Абсолютный путь папки проекта. */
  folder: string;
  /** Фрагмент пути. Пустой — начало списка: человек ещё не начал печатать. */
  query: string;
  /** Сколько путей вернуть. Больше человек всё равно не прочитает, а подсказка становится списком. */
  limit?: number;
  /**
   * Насколько глубоко спускаться. Предел нужен не ради скорости, а ради завершимости: симлинк на
   * родителя закольцевал бы обход, а разворачивать симлинки мы не будем.
   */
  maxDepth?: number;
  /** Сколько записей обойти всего. Последняя защита от папки, где файлов миллион. */
  maxEntries?: number;
};

export type ProjectFileSearch = {
  paths: string[];
  /** Список обрезан пределом, а не кончился. */
  truncated: boolean;
};

const defaultLimit = 30;
const defaultMaxDepth = 12;
const defaultMaxEntries = 20_000;

export function searchProjectFiles(options: ProjectFileSearchOptions): ProjectFileSearch {
  const limit = options.limit ?? defaultLimit;
  const maxDepth = options.maxDepth ?? defaultMaxDepth;
  const maxEntries = options.maxEntries ?? defaultMaxEntries;
  const needle = options.query.trim().toLowerCase();
  const found: { path: string; inName: boolean }[] = [];
  let visited = 0;
  let stopped = false;

  const walk = (directory: string, depth: number): void => {
    if (depth > maxDepth || stopped) {
      return;
    }

    let entries;

    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      // Каталог без права чтения — не сбой поиска: остальные показываются как ни в чём не бывало.
      return;
    }

    for (const entry of entries) {
      if (stopped) {
        return;
      }

      visited += 1;

      if (visited > maxEntries) {
        stopped = true;

        return;
      }

      const full = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) {
          walk(full, depth + 1);
        }

        continue;
      }

      // Симлинки не разворачиваются: цель может лежать вне папки проекта, а `@файл` обещает
      // проектный ресурс. Разворачивать их значило бы обещать больше, чем сказано.
      if (!entry.isFile()) {
        continue;
      }

      const path = toPosix(relative(options.folder, full));

      // Выход за корень невозможен по построению, но проверяется явно: путь едет в текст сообщения.
      if (path === "" || path.startsWith("../")) {
        continue;
      }

      const inName = entry.name.toLowerCase().includes(needle);

      if (needle !== "" && !inName && !path.toLowerCase().includes(needle)) {
        continue;
      }

      found.push({ path, inName });
    }
  };

  walk(options.folder, 0);

  // Совпадение в имени файла раньше совпадения в каталоге: набирая `@readme`, человек ищет файл, а
  // не всё, что лежит в папке с таким именем. Дальше — по алфавиту, чтобы порядок не зависел от
  // порядка чтения каталога.
  found.sort((left, right) =>
    left.inName === right.inName
      ? left.path.localeCompare(right.path)
      : Number(right.inName) - Number(left.inName),
  );

  return {
    paths: found.slice(0, limit).map((one) => one.path),
    truncated: stopped || found.length > limit,
  };
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
