/**
 * Снимок настроек и его перечитывание на живом демоне (ADR-0033). Наблюдается директория данных, а
 * не файлы: наблюдатель на файле умирает после первой же атомарной замены — он держит старый inode,
 * а `rename` подставляет новый ([runtime-checks.md](../../../docs/runtime-checks.md), проверка 12).
 */

import {
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";

import {
  configFileName,
  defaultConfig,
  defaultPreferences,
  parseConfig,
  parsePreferences,
  preferencesFileName,
  type AppearancePreferences,
  type Config,
  type PluginPreferences,
  type Preferences,
  type SettingsParseResult,
} from "@sovereign/protocol";

import type { Logger } from "./logger.ts";

export type SettingsSnapshot = {
  config: Config;
  preferences: Preferences;
};

export type SettingsListener = (snapshot: SettingsSnapshot) => void;

export type SettingsStore = {
  current: () => SettingsSnapshot;
  /** Возвращает функцию отписки. */
  subscribe: (listener: SettingsListener) => () => void;
  /**
   * Первое чтение и наблюдатель. Логгер приходит сюда, а не в конструктор: его уровень читается из
   * снимка настроек, то есть логгер создаётся после хранилища, — а диагностика первого чтения
   * обязана в него попасть.
   */
  start: (logger: Logger) => void;
  /** Перечитать оба файла сейчас. Тот же путь, которым идёт наблюдатель. */
  reload: () => void;
  /**
   * Записать предпочтения одного плагина в `preferences.json` и сразу перечитать файл: вызывающий
   * получает управление тогда, когда снимок уже новый.
   */
  writePluginPreferences: (pluginKey: string, preferences: PluginPreferences) => WriteOutcome;
  /** Тем же путём и с тем же отказом: внешний вид и локаль лежат в том же файле. */
  writeAppearancePreferences: (preferences: AppearancePreferences) => WriteOutcome;
  close: () => void;
};

export type WriteOutcome =
  | { kind: "written" }
  /** Файл на диске не читается. Записать поверх — значит стереть чужую правку (ADR-0033). */
  | { kind: "refused"; reason: string };

export type CreateSettingsStoreOptions = {
  directory: string;
  debounceMilliseconds?: number;
};

/** Одна запись даёт несколько событий (runtime-checks, проверка 12), поэтому дребезг подавляется. */
const defaultDebounceMilliseconds = 50;

export function createSettingsStore(options: CreateSettingsStoreOptions): SettingsStore {
  const { directory } = options;
  const debounceMilliseconds = options.debounceMilliseconds ?? defaultDebounceMilliseconds;
  const listeners = new Set<SettingsListener>();

  let logger: Logger | undefined;
  let snapshot: SettingsSnapshot = { config: defaultConfig, preferences: defaultPreferences };
  let watcher: FSWatcher | undefined;
  let debounceTimer: NodeJS.Timeout | undefined;

  const readSettingsFile = <Value>(
    fileName: string,
    parse: (raw: unknown) => SettingsParseResult<Value>,
    previous: Value,
    active: Logger,
  ): Value => {
    const raw = readFileIfExists(join(directory, fileName));

    // Отсутствие файла равно пустому документу: значения по умолчанию живут в коде.
    if (raw === undefined) {
      const empty = parse({});

      return empty.kind === "parsed" ? empty.value : previous;
    }

    let document: unknown;

    try {
      document = JSON.parse(raw);
    } catch (cause) {
      active.error("the settings file is not valid json and was not applied", {
        file: fileName,
        reason: cause instanceof Error ? cause.message : String(cause),
      });

      return previous;
    }

    const result = parse(document);

    for (const diagnostic of result.diagnostics) {
      active.warn(diagnostic, { file: fileName });
    }

    // Невалидный файл не применяется и не затирается: действует прежний снимок (ADR-0033).
    if (result.kind === "rejected") {
      active.error("the settings file was not applied, the previous values stay in effect", {
        file: fileName,
      });

      return previous;
    }

    return result.value;
  };

  const reload = (): void => {
    const active = logger;

    if (active === undefined) {
      throw new Error("The settings store must be started before it can read the files.");
    }

    const next: SettingsSnapshot = {
      config: readSettingsFile(configFileName, parseConfig, snapshot.config, active),
      preferences: readSettingsFile(
        preferencesFileName,
        parsePreferences,
        snapshot.preferences,
        active,
      ),
    };

    // Событие от собственной записи демона неотличимо от правки руками, поэтому перечитывание
    // идемпотентно: совпавший снимок никого не будит. Сравнение сериализацией законно — снимок
    // собираем мы сами, порядок ключей в нём детерминирован.
    if (JSON.stringify(next) === JSON.stringify(snapshot)) {
      return;
    }

    snapshot = next;

    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const start = (activeLogger: Logger): void => {
    logger = activeLogger;

    const active = watch(directory);

    active.on("change", (_event, changed) => {
      // Рядом лежат лок, временные файлы записи и позже база: фильтр по имени — часть решения,
      // а не оптимизация (ADR-0033).
      const fileName = typeof changed === "string" ? changed : changed?.toString();

      if (fileName !== configFileName && fileName !== preferencesFileName) {
        return;
      }

      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(reload, debounceMilliseconds);
    });

    // Ошибка наблюдателя не глушится: без него настройки молча перестанут перечитываться.
    active.on("error", (cause: Error) => {
      activeLogger.error("the settings watcher failed", { reason: cause.message });
    });

    watcher = active;

    // Чтение — после наблюдателя, а не до него: наблюдатель встаёт не мгновенно, и события первых
    // миллисекунд теряются насовсем (runtime-checks.md, проверка 14). Правка, потерянная не успевшим
    // встать наблюдателем, при таком порядке всё равно попадает в этот первый снимок.
    reload();
  };

  const patchPreferences = (
    patch: (document: Record<string, unknown>) => Record<string, unknown>,
  ): WriteOutcome => {
    // Основа для записи — файл, а не снимок в памяти: между перечитываниями его мог поправить
    // человек, и переключение одного плагина не должно откатывать соседнюю строку.
    const stored = readStoredPreferences(join(directory, preferencesFileName));

    if (stored.kind === "refused") {
      return stored;
    }

    writeAtomically(
      join(directory, preferencesFileName),
      `${JSON.stringify(patch(stored.document), undefined, 2)}\n`,
    );

    // Наблюдатель принесёт своё событие следом и вызовет перечитывание второй раз. Второе ничего не
    // сделает: совпавший снимок никого не будит.
    reload();

    return { kind: "written" };
  };

  return {
    current: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    start,
    reload,
    writePluginPreferences: (pluginKey, preferences) =>
      patchPreferences((document) => ({
        ...document,
        plugins: { ...(asObject(document["plugins"]) ?? {}), [pluginKey]: preferences },
      })),
    writeAppearancePreferences: ({ appearance, locale }) =>
      patchPreferences((document) => ({ ...document, appearance, locale })),
    close: () => {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }

      watcher?.close();
      watcher = undefined;
    },
  };
}

type StoredPreferences =
  /** Документ как он лежит на диске, а не разобранный снимок: см. `readStoredPreferences`. */
  { kind: "read"; document: Record<string, unknown> } | { kind: "refused"; reason: string };

/**
 * Читает файл для правки. Пишется потом **этот документ** с заменённым полем, а не сериализованный
 * снимок: снимок не знает о ключах, которых нет в схеме, и запись из интерфейса молча уносила бы
 * настройку, написанную более новой версией платформы или руками (ADR-0049).
 *
 * Разбор при этом всё равно нужен: чинить негодный файл записью поверх нельзя (ADR-0033).
 */
function readStoredPreferences(path: string): StoredPreferences {
  const raw = readFileIfExists(path);

  if (raw === undefined) {
    return { kind: "read", document: {} };
  }

  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return {
      kind: "refused",
      reason: `${preferencesFileName} is not valid json: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const parsed = parsePreferences(document);

  if (parsed.kind === "rejected") {
    return { kind: "refused", reason: parsed.diagnostics.join("; ") };
  }

  // Верхний уровень не объект — это уже отказ выше, так что здесь остаётся только объект.
  return { kind: "read", document: asObject(document) ?? {} };
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

/**
 * Замена целиком, а не дописывание: наблюдатель не должен увидеть половину файла, а оборванная на
 * середине запись не должна оставить настройки битыми (ADR-0033).
 */
function writeAtomically(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;

  try {
    writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (cause) {
    // Временный файл рядом с настройками пережил бы перезапуск и остался мусором в чужой
    // директории; удалить его не удалось только если его и не создали.
    try {
      unlinkSync(temporary);
    } catch {
      // Нечего убирать.
    }

    throw cause;
  }
}

function readFileIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }

    throw cause;
  }
}
