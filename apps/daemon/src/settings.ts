/**
 * Снимок настроек и его перечитывание на живом демоне (ADR-0033). Наблюдается директория данных, а
 * не файлы: наблюдатель на файле умирает после первой же атомарной замены — он держит старый inode,
 * а `rename` подставляет новый ([runtime-checks.md](../../../docs/runtime-checks.md), проверка 12).
 */

import { readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import {
  configFileName,
  defaultConfig,
  defaultPreferences,
  parseConfig,
  parsePreferences,
  preferencesFileName,
  type Config,
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
  close: () => void;
};

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

  return {
    current: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    start,
    reload,
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
