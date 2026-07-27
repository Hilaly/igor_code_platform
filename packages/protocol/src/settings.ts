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
import { pluginIdPattern, pluginSources, type PluginSource } from "./plugin.ts";

export const configFileName = "config.json";
export const preferencesFileName = "preferences.json";

/** Параметров развёртывания здесь нет: порт и путь приходят аргументами запуска (ADR-0034). */
export type Config = {
  /** Применяется живьём. */
  logLevel: LogLevel;
};

/**
 * Что человек включил и выключил. Отсутствие записи — не «выключено», а «не видели»: значение по
 * умолчанию зависит от источника плагина (ADR-0018, ADR-0019), и запись появляется, только когда
 * решение принято.
 */
export type PluginPreferences = {
  enabled: boolean;
  /** Идентификаторы вкладов, выключенных человеком (ADR-0032). Остальные включены. */
  disabledContributions: string[];
};

/** Тема и локаль придут вместе со своими потребителями. */
export type Preferences = {
  /** Ключ — `<источник>:<id>`: перекрывающая копия плагина это другой плагин (ADR-0067). */
  plugins: Record<string, PluginPreferences>;
};

export const defaultConfig: Config = { logLevel: "info" };
export const defaultPreferences: Preferences = { plugins: {} };

/** Названный в файле плагин по умолчанию включён: незачем называть его, чтобы ничего не сказать. */
const defaultPluginPreferences: PluginPreferences = { enabled: true, disabledContributions: [] };

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

  const diagnostics = diagnoseUnknownKeys(preferencesFileName, fields, ["plugins"]);
  const declared = fields["plugins"];

  if (declared === undefined) {
    return { kind: "parsed", value: { plugins: {} }, diagnostics };
  }

  const entries = asObject(declared);

  if (entries === undefined) {
    diagnostics.push(`${preferencesFileName}: plugins must be an object keyed by <source>:<id>`);

    return { kind: "rejected", diagnostics };
  }

  const plugins: Record<string, PluginPreferences> = {};

  for (const [key, raw] of Object.entries(entries)) {
    // Ключ неизвестной формы — диагностика, а не отказ: источники прибавляются, и файл, написанный
    // более новой платформой, обязан читаться старой.
    if (!isPluginKey(key)) {
      diagnostics.push(
        `${preferencesFileName}: plugins key ${JSON.stringify(key)} is not <source>:<id> and is ignored`,
      );

      continue;
    }

    const entry = asObject(raw);

    if (entry === undefined) {
      diagnostics.push(`${preferencesFileName}: plugins.${key} must be an object`);

      return { kind: "rejected", diagnostics };
    }

    diagnostics.push(
      ...diagnoseUnknownKeys(`${preferencesFileName}: plugins.${key}`, entry, [
        "enabled",
        "disabledContributions",
      ]),
    );

    const enabled = entry["enabled"];

    if (enabled !== undefined && typeof enabled !== "boolean") {
      diagnostics.push(
        `${preferencesFileName}: plugins.${key}.enabled must be a boolean, got ${JSON.stringify(enabled)}`,
      );

      return { kind: "rejected", diagnostics };
    }

    const disabled = entry["disabledContributions"];

    if (disabled !== undefined && !isStringArray(disabled)) {
      diagnostics.push(
        `${preferencesFileName}: plugins.${key}.disabledContributions must be an array of contribution identifiers`,
      );

      return { kind: "rejected", diagnostics };
    }

    plugins[key] = {
      enabled: enabled ?? defaultPluginPreferences.enabled,
      disabledContributions: disabled ?? [],
    };
  }

  return { kind: "parsed", value: { plugins }, diagnostics };
}

function isPluginKey(key: string): boolean {
  const [source, ...rest] = key.split(":");
  const id = rest.join(":");

  return (
    rest.length === 1 && pluginSources.includes(source as PluginSource) && pluginIdPattern.test(id)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
