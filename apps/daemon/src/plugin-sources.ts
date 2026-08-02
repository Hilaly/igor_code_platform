/**
 * Обнаружение плагинов в корнях-источниках (docs/repository-structure.md). Источник — не просто место на диске: он же
 * ранг специфичности при споре вкладов (docs/plugins.md) и часть ключа плагина, потому что перекрывающая
 * копия — это другой плагин со своим включением и своим хранилищем (docs/plugins.md).
 *
 * Здесь ничего не исполняется и ничего не пишется в журнал: обход отдаёт результат, а решает и
 * докладывает вызывающий. Иначе обнаружение не проверить тестом.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  manifestFileName,
  parsePluginManifest,
  projectPluginSource,
  type PluginManifest,
  type PluginSource,
  type ProjectAvailability,
} from "@sovereign/protocol";

export type PluginRoot = {
  source: PluginSource;
  directory: string;
};

export type DiscoveredPlugin = {
  /** `<источник>:<id>` — ключ включения, хранилища и всего, что привязано к плагину. */
  key: string;
  source: PluginSource;
  id: string;
  directory: string;
  manifest: PluginManifest;
  /** Абсолютный путь к воркерной точке входа: он уже проверен на существование. */
  workerEntry: string;
  diagnostics: string[];
};

/** Плагин объявлен, но взять его нельзя — и это не решение человека (docs/plugins.md). */
export type RefusedPlugin = {
  source: PluginSource;
  directory: string;
  /** Может отсутствовать: манифест не прочитан именно потому, что он сломан. */
  id?: string;
  reason: string;
  diagnostics: string[];
};

export type PluginDiscovery = {
  plugins: DiscoveredPlugin[];
  refused: RefusedPlugin[];
};

export function pluginKey(source: PluginSource, id: string): string {
  return `${source}:${id}`;
}

/**
 * Встроенный источник — каталог `plugins/` репозитория (docs/repository-structure.md). В продакшн-сборке он приедет
 * распакованным артефактом, но сборки ещё нет, поэтому путь считается от исходников.
 */
export function defaultPluginRoots(dataDirectory: string): PluginRoot[] {
  return [
    { source: "builtin", directory: join(import.meta.dirname, "..", "..", "..", "plugins") },
    { source: "data", directory: join(dataDirectory, "plugins") },
  ];
}

/**
 * Третий, самый частный источник — папка `.sovereign/plugins/` внутри папки проекта
 * (docs/sessions-and-projects.md, docs/plugins.md). Корней столько, сколько проектов, и набор
 * меняется на живом демоне: проект создали, архивировали, папку отмонтировали.
 *
 * Источник даётся не всякому проекту:
 *
 * - **архивный не даёт** — «убран с глаз» обязано значить и «его код не работает», иначе
 *   архивация выключает проект в интерфейсе, но оставляет его плагины перекрывать чужие вклады;
 * - **проект с недоступной папкой не даёт** — читать оттуда нечего;
 * - **эфемерный даёт** (docs/sessions-and-projects.md): плагин, положенный в `work`, перекрывает
 *   встроенный, и это записано прямо.
 */
export function projectPluginRoots(
  projects: readonly ProjectPluginFolder[],
  availability: (project: ProjectPluginFolder) => ProjectAvailability,
): PluginRoot[] {
  return projects
    .filter((project) => !project.archived && availability(project) === "available")
    .map((project) => ({
      source: projectPluginSource(project.id),
      directory: join(project.folder, ".sovereign", "plugins"),
    }));
}

/** Ровно то, что нужно от записи проекта для обхода корней: имя модуля проектов сюда не тянется. */
export type ProjectPluginFolder = {
  id: string;
  folder: string;
  archived: boolean;
};

export function discoverPlugins(roots: PluginRoot[]): PluginDiscovery {
  const plugins: DiscoveredPlugin[] = [];
  const refused: RefusedPlugin[] = [];

  for (const root of roots) {
    const found: DiscoveredPlugin[] = [];

    for (const directory of pluginDirectories(root.directory)) {
      const outcome = readPluginFolder(root.source, directory);

      if (outcome === undefined) {
        continue;
      }

      if ("reason" in outcome) {
        refused.push(outcome);
        continue;
      }

      found.push(outcome);
    }

    // Два одинаковых идентификатора в одном источнике: победителя нет, потому что выбирать не по
    // чему — ранг у них общий (docs/plugins.md). Оба отказаны, обе папки названы.
    const byId = new Map<string, DiscoveredPlugin[]>();

    for (const plugin of found) {
      byId.set(plugin.id, [...(byId.get(plugin.id) ?? []), plugin]);
    }

    for (const [id, claimants] of byId) {
      const first = claimants[0];

      if (claimants.length === 1 && first !== undefined) {
        plugins.push(first);
        continue;
      }

      for (const claimant of claimants) {
        refused.push({
          source: claimant.source,
          directory: claimant.directory,
          id,
          reason: `the identifier ${id} is claimed by ${claimants.length} folders in the same source: ${claimants
            .map((other) => other.directory)
            .join(", ")}`,
          diagnostics: claimant.diagnostics,
        });
      }
    }
  }

  return { plugins, refused };
}

function pluginDirectories(root: string): string[] {
  let entries;

  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (cause) {
    // Отсутствующий корень — норма: встроенных плагинов может не быть, папки в данных может не быть.
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return [];
    }

    throw cause;
  }

  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && name !== "node_modules")
    .sort()
    .map((name) => join(root, name));
}

function readPluginFolder(
  source: PluginSource,
  directory: string,
): DiscoveredPlugin | RefusedPlugin | undefined {
  let raw;

  try {
    raw = readFileSync(join(directory, manifestFileName), "utf8");
  } catch (cause) {
    // Папка без package.json плагином себя не объявляла — это не поломка, а чужая папка.
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }

    throw cause;
  }

  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return {
      source,
      directory,
      reason: `${manifestFileName} is not valid json: ${cause instanceof Error ? cause.message : String(cause)}`,
      diagnostics: [],
    };
  }

  const result = parsePluginManifest(document);

  if (result.kind === "absent") {
    return undefined;
  }

  if (result.kind === "refused") {
    return { source, directory, reason: result.reason, diagnostics: result.diagnostics };
  }

  const manifest = result.value;
  const workerEntry = join(directory, manifest.worker);

  if (!isFile(workerEntry)) {
    return {
      source,
      directory,
      id: manifest.id,
      reason: `the worker entry point ${manifest.worker} does not exist`,
      diagnostics: result.diagnostics,
    };
  }

  return {
    key: pluginKey(source, manifest.id),
    source,
    id: manifest.id,
    directory,
    manifest,
    workerEntry,
    diagnostics: result.diagnostics,
  };
}

/** Причина недоступности здесь не важна: и «нет», и «не читается» одинаково значат «точки входа нет». */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
