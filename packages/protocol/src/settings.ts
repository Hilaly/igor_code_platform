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

/** Светлый и тёмный — варианты внутри схемы, а не две схемы (ADR-0028). */
export const appearanceVariants = ["light", "dark", "system"] as const;

export type AppearanceVariant = (typeof appearanceVariants)[number];

export type Appearance = {
  /** Идентификатор цветовой схемы; схему может добавить плагин (ADR-0028). */
  colorScheme: string;
  variant: AppearanceVariant;
};

/** Идентификатор встроенной схемы. Она есть всегда: заменить её нечем, пока плагинов нет. */
export const baseColorScheme = "base";

/** Базовая локаль английская, русская идёт в поставке (ADR-0028). */
export const baseLocale = "en";

export type Preferences = {
  /** Ключ — `<источник>:<id>`: перекрывающая копия плагина это другой плагин (ADR-0067). */
  plugins: Record<string, PluginPreferences>;
  appearance: Appearance;
  /** Тег локали для `Intl`. */
  locale: string;
};

export const defaultConfig: Config = { logLevel: "info" };
export const defaultAppearance: Appearance = {
  colorScheme: baseColorScheme,
  variant: "system",
};
export const defaultPreferences: Preferences = {
  plugins: {},
  appearance: defaultAppearance,
  locale: baseLocale,
};

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

  const diagnostics = diagnoseUnknownKeys(preferencesFileName, fields, [
    "plugins",
    "appearance",
    "locale",
  ]);
  const plugins = parsePluginsSection(fields["plugins"]);

  diagnostics.push(...plugins.diagnostics);

  if (plugins.kind === "rejected") {
    return { kind: "rejected", diagnostics };
  }

  const appearance = parseAppearance(fields["appearance"]);

  diagnostics.push(...appearance.diagnostics);

  if (appearance.kind === "rejected") {
    return { kind: "rejected", diagnostics };
  }

  const locale = parseLocale(fields["locale"]);

  diagnostics.push(...locale.diagnostics);

  if (locale.kind === "rejected") {
    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: { plugins: plugins.value, appearance: appearance.value, locale: locale.value },
    diagnostics,
  };
}

/**
 * Внешний вид и локаль. Отдельно от файла, потому что тем же телом они меняются через веб-API: форма
 * одна, файл остаётся источником истины (ADR-0033).
 */
export function parseAppearance(
  raw: unknown,
  label = `${preferencesFileName}: appearance`,
): SettingsParseResult<Appearance> {
  if (raw === undefined) {
    return { kind: "parsed", value: { ...defaultAppearance }, diagnostics: [] };
  }

  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, ["colorScheme", "variant"]);
  const colorScheme = fields["colorScheme"];

  if (colorScheme !== undefined && (typeof colorScheme !== "string" || colorScheme === "")) {
    diagnostics.push(`${label}.colorScheme must be a non-empty scheme identifier`);

    return { kind: "rejected", diagnostics };
  }

  const variant = fields["variant"];

  if (variant !== undefined && !isAppearanceVariant(variant)) {
    diagnostics.push(
      `${label}.variant must be one of ${appearanceVariants.join(", ")}, got ${JSON.stringify(variant)}`,
    );

    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: {
      colorScheme: colorScheme ?? defaultAppearance.colorScheme,
      variant: variant ?? defaultAppearance.variant,
    },
    diagnostics,
  };
}

/** Годность тега проверяет `Intl`, а не наш шаблон: список тегов нам не принадлежит. */
export function parseLocale(
  raw: unknown,
  label = `${preferencesFileName}: locale`,
): SettingsParseResult<string> {
  if (raw === undefined) {
    return { kind: "parsed", value: baseLocale, diagnostics: [] };
  }

  if (typeof raw !== "string") {
    return { kind: "rejected", diagnostics: [`${label} must be a locale tag`] };
  }

  try {
    Intl.getCanonicalLocales(raw);
  } catch {
    return {
      kind: "rejected",
      diagnostics: [`${label} must be a locale tag like "en" or "ru", got ${JSON.stringify(raw)}`],
    };
  }

  return { kind: "parsed", value: raw, diagnostics: [] };
}

function parsePluginsSection(raw: unknown): SettingsParseResult<Record<string, PluginPreferences>> {
  if (raw === undefined) {
    return { kind: "parsed", value: {}, diagnostics: [] };
  }

  const entries = asObject(raw);

  if (entries === undefined) {
    return {
      kind: "rejected",
      diagnostics: [`${preferencesFileName}: plugins must be an object keyed by <source>:<id>`],
    };
  }

  const diagnostics: string[] = [];
  const plugins: Record<string, PluginPreferences> = {};

  for (const [key, declared] of Object.entries(entries)) {
    // Ключ неизвестной формы — диагностика, а не отказ: источники прибавляются, и файл, написанный
    // более новой платформой, обязан читаться старой.
    if (!isPluginKey(key)) {
      diagnostics.push(
        `${preferencesFileName}: plugins key ${JSON.stringify(key)} is not <source>:<id> and is ignored`,
      );

      continue;
    }

    const entry = parsePluginPreferences(declared, `${preferencesFileName}: plugins.${key}`);

    diagnostics.push(...entry.diagnostics);

    if (entry.kind === "rejected") {
      return { kind: "rejected", diagnostics };
    }

    plugins[key] = entry.value;
  }

  return { kind: "parsed", value: plugins, diagnostics };
}

/**
 * Предпочтения одного плагина. Отдельно от файла, потому что тем же телом плагин переключается через
 * веб-API: форма одна, файл остаётся источником истины (ADR-0033), и разойтись им не на чем.
 */
export function parsePluginPreferences(
  raw: unknown,
  label = "preferences",
): SettingsParseResult<PluginPreferences> {
  const entry = asObject(raw);

  if (entry === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, entry, ["enabled", "disabledContributions"]);
  const enabled = entry["enabled"];

  if (enabled !== undefined && typeof enabled !== "boolean") {
    diagnostics.push(`${label}.enabled must be a boolean, got ${JSON.stringify(enabled)}`);

    return { kind: "rejected", diagnostics };
  }

  const disabled = entry["disabledContributions"];

  if (disabled !== undefined && !isStringArray(disabled)) {
    diagnostics.push(`${label}.disabledContributions must be an array of contribution identifiers`);

    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: {
      enabled: enabled ?? defaultPluginPreferences.enabled,
      disabledContributions: disabled ?? [],
    },
    diagnostics,
  };
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

function isAppearanceVariant(value: unknown): value is AppearanceVariant {
  return appearanceVariants.includes(value as AppearanceVariant);
}

function isLogLevel(value: unknown): value is LogLevel {
  return logLevels.includes(value as LogLevel);
}
