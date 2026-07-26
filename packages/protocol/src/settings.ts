/**
 * Файлы настроек (ADR-0033): `config.json` пишет человек, `preferences.json` — платформа по
 * действию пользователя. Разбор живёт здесь, а не в демоне, потому что схема — часть контракта:
 * по ней же интерфейс объясняет, что в файле не так.
 *
 * Разбор целиком: либо новый снимок применяется весь, либо остаётся прежний. Неизвестный ключ при
 * этом не отказ, а диагностика — иначе понижение версии платформы перестанет стартовать на файле,
 * написанном более новой.
 */

import { logLevels, type LogLevel } from "./log.ts";

export const configFileName = "config.json";
export const preferencesFileName = "preferences.json";

/** Параметров развёртывания здесь нет: порт и путь приходят аргументами запуска (ADR-0034). */
export type Config = {
  /** Применяется живьём. */
  logLevel: LogLevel;
};

/**
 * Полей пока нет: тема, локаль, включённость плагинов и вкладов придут вместе со своими
 * потребителями. Файл при этом читается и проверяется уже сейчас — чтобы правка руками работала
 * с первого дня, а не с первой настройки.
 */
export type Preferences = Record<string, never>;

export const defaultConfig: Config = { logLevel: "info" };
export const defaultPreferences: Preferences = {};

export type SettingsParseResult<Value> =
  | { kind: "parsed"; value: Value; diagnostics: string[] }
  /** Файл прочитан, но применить его нельзя: частичного применения нет (ADR-0033). */
  | { kind: "rejected"; diagnostics: string[] };

export function parseConfig(raw: unknown): SettingsParseResult<Config> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${configFileName}: the top level is not an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(configFileName, fields, ["logLevel"]);
  const value: Config = { ...defaultConfig };
  const logLevel = fields["logLevel"];

  if (logLevel !== undefined) {
    if (!isLogLevel(logLevel)) {
      diagnostics.push(
        `${configFileName}: logLevel must be one of ${logLevels.join(", ")}, got ${JSON.stringify(logLevel)}`,
      );

      return { kind: "rejected", diagnostics };
    }

    value.logLevel = logLevel;
  }

  return { kind: "parsed", value, diagnostics };
}

export function parsePreferences(raw: unknown): SettingsParseResult<Preferences> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return {
      kind: "rejected",
      diagnostics: [`${preferencesFileName}: the top level is not an object`],
    };
  }

  return {
    kind: "parsed",
    value: { ...defaultPreferences },
    diagnostics: diagnoseUnknownKeys(preferencesFileName, fields, []),
  };
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function diagnoseUnknownKeys(
  file: string,
  fields: Record<string, unknown>,
  known: string[],
): string[] {
  return Object.keys(fields)
    .filter((key) => !known.includes(key))
    .map((key) => `${file}: unknown key ${JSON.stringify(key)} is ignored`);
}

function isLogLevel(value: unknown): value is LogLevel {
  return logLevels.includes(value as LogLevel);
}
