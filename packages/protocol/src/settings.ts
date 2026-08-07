/**
 * Файлы настроек (docs/data-directory.md): `config.json` пишет человек, `preferences.json` — платформа по
 * действию пользователя. Разбор живёт здесь, а не в демоне, потому что схема — часть контракта:
 * по ней же интерфейс объясняет, что в файле не так.
 *
 * Разбор целиком: либо новый снимок применяется весь, либо остаётся прежний. Неизвестный ключ при
 * этом не отказ, а диагностика — иначе понижение версии платформы перестанет стартовать на файле,
 * написанном более новой.
 */

import { logLevels, type LogLevel } from "./log.ts";
import { isPluginSource, pluginIdPattern } from "./plugin.ts";

export const configFileName = "config.json";
export const preferencesFileName = "preferences.json";

/** Параметров развёртывания здесь нет: порт и путь приходят аргументами запуска (docs/data-directory.md). */
export type Config = {
  /** Применяется живьём. */
  logLevel: LogLevel;
  /**
   * Сколько сессий разом ходят к модели (docs/architecture.md). Считается любой поход, а не только
   * турн: компакция и суммаризация ветки тоже занимают слот. Применяется живьём — предел
   * спрашивается в момент, когда слот освобождается, а не при старте демона.
   */
  maxConcurrentTurns: number;
  /**
   * Доля контекстного окна модели, после которой компакция запускается сама. `0` — выключено, и это
   * умолчание: компакция стоит денег и необратимо меняет разговор, поэтому её включает человек
   * (docs/roadmap.md, срез 10b).
   *
   * Доля, а не число токенов: окна моделей различаются на порядок, и одно и то же абсолютное число
   * означало бы на разных моделях совершенно разное.
   */
  compactionThreshold: number;
  /**
   * Сколько токенов окна оставить под ответ модели и сколько хвоста разговора не трогать. Наши, а не
   * рантаймовые: Pi зашивает их константой и параметром `compact()` не принимает, поэтому платформа
   * собирает компакцию сама и подсовывает её хуком (docs/sessions-and-projects.md).
   */
  compactionReserveTokens: number;
  compactionKeepRecentTokens: number;
  /**
   * Сколько ждать обработчик хука в воркере плагина (docs/hooks.md). Одно значение на все хуки:
   * отдельной величины на вид хука или на подписку нет, пока не появится потребность, которую нельзя
   * закрыть общей. Ждать вообще приходится потому, что плагины живут в воркерах, а Pi вызывает
   * обработчики с `await` последовательно.
   */
  hookTimeoutMilliseconds: number;
  /**
   * Сколько ждать инструмент плагина. Отдельно от хуков, и это не исключение из правила «одно
   * значение на все хуки»: инструмент — не хук. Хук ждут внутри турна, и он обязан быть быстрым;
   * инструмент модель зовёт как работу, и секунды ему мало у любого плагина, который что-то читает
   * по сети (docs/hooks.md).
   */
  pluginToolTimeoutMilliseconds: number;
  /**
   * Сколько ждать ответ воркера на запрос к маршруту плагина (docs/web-api.md). Отдельно от
   * инструмента: инструмент ждёт модель, а здесь ждёт живое HTTP-соединение, и держать его те же две
   * минуты значит держать открытым сокет того, кто давно ушёл.
   */
  pluginRouteTimeoutMilliseconds: number;
  /**
   * Предел тела запроса к маршруту плагина. Отдельно от общего лимита ядра: тела наших запросов —
   * короткий json, а вебхук приносит нагрузку чужого сервиса.
   */
  pluginRouteBodyLimitBytes: number;
  /**
   * Сколько вызовов в минуту принимает публичный маршрут с одного адреса. Часть механизма, а не
   * пожелание: иначе один публичный маршрут превращает демон в мишень (docs/web-api.md).
   */
  publicRouteRequestsPerMinute: number;
};

/**
 * Что человек включил и выключил. Отсутствие записи — не «выключено», а «не видели»: значение по
 * умолчанию зависит от источника плагина (docs/plugins.md), и запись появляется, только когда
 * решение принято.
 */
export type PluginPreferences = {
  enabled: boolean;
  /** Идентификаторы вкладов, выключенных человеком (docs/plugins.md). Остальные включены. */
  disabledContributions: string[];
};

/** Светлый и тёмный — варианты внутри схемы, а не две схемы (docs/ui-kit.md). */
export const appearanceVariants = ["light", "dark", "system"] as const;

export type AppearanceVariant = (typeof appearanceVariants)[number];

/**
 * Ось масштаба интерфейса: кегль, шаг отступов и высота контролов (docs/ui-kit.md). Значений три, и
 * список закрыт — это выбор из трёх ступеней, а не произвольный множитель.
 */
export const interfaceScales = ["smaller", "default", "larger"] as const;

export type InterfaceScale = (typeof interfaceScales)[number];

/** Нужен и снаружи: браузер проверяет им кеш выбора, переживший обновление платформы. */
export function isInterfaceScale(value: unknown): value is InterfaceScale {
  return interfaceScales.includes(value as InterfaceScale);
}

export type Appearance = {
  /** Идентификатор цветовой схемы; схему может добавить плагин (docs/ui-kit.md). */
  colorScheme: string;
  variant: AppearanceVariant;
  scale: InterfaceScale;
};

/** Идентификатор встроенной схемы. Она есть всегда: заменить её нечем, пока плагинов нет. */
export const builtInColorScheme = "imperium";

/** Базовая локаль английская, русская идёт в поставке (docs/ui-kit.md). */
export const baseLocale = "en";

export type Preferences = {
  /** Ключ — `<источник>:<id>`: перекрывающая копия плагина это другой плагин (docs/plugins.md). */
  plugins: Record<string, PluginPreferences>;
  appearance: Appearance;
  /** Тег локали для `Intl`. */
  locale: string;
};

/** Раздел файла, которым владеет оболочка: он же тело и ответ маршрута `preferences-api.ts`. */
export type AppearancePreferences = {
  appearance: Appearance;
  locale: string;
};

export const defaultConfig: Config = {
  logLevel: "info",
  maxConcurrentTurns: 4,
  compactionThreshold: 0,
  // Совпадают с зашитыми в Pi: своя компакция заведена ради управляемости, а не ради других чисел.
  compactionReserveTokens: 16384,
  compactionKeepRecentTokens: 20000,
  // Пять секунд — предположение, а не измерение: первый же плагин с обращением к сети внутри хука
  // покажет, мало это или много (docs/hooks.md).
  hookTimeoutMilliseconds: 5000,
  pluginToolTimeoutMilliseconds: 120000,
  pluginRouteTimeoutMilliseconds: 30000,
  pluginRouteBodyLimitBytes: 1048576,
  publicRouteRequestsPerMinute: 60,
};
export const defaultAppearance: Appearance = {
  colorScheme: builtInColorScheme,
  variant: "system",
  scale: "default",
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
  /** Файл прочитан, но применить его нельзя: частичного применения нет (docs/data-directory.md). */
  | { kind: "rejected"; diagnostics: string[] };

/**
 * Ключи конфига одним списком: по нему проверяется и незнакомый ключ в файле, и полнота документа,
 * приехавшего через API. Собирается из объекта-таблицы, а не пишется массивом: `satisfies` тогда
 * ловит забытый ключ, а забытый здесь ключ означал бы настройку, которую нельзя изменить из
 * интерфейса, — и обнаружилось бы это только запуском.
 */
const everyConfigKey = {
  logLevel: true,
  maxConcurrentTurns: true,
  compactionThreshold: true,
  compactionReserveTokens: true,
  compactionKeepRecentTokens: true,
  hookTimeoutMilliseconds: true,
  pluginToolTimeoutMilliseconds: true,
  pluginRouteTimeoutMilliseconds: true,
  pluginRouteBodyLimitBytes: true,
  publicRouteRequestsPerMinute: true,
} satisfies Record<keyof Config, true>;

export const configKeys = Object.keys(everyConfigKey) as (keyof Config)[];

/**
 * Чтение файла: отсутствующий ключ берёт значение по умолчанию. Умолчания живут в коде, поэтому
 * пустой `config.json` — это не «всё выключено», а «ничего не сказано» (docs/data-directory.md).
 */
export function parseConfig(raw: unknown): SettingsParseResult<Config> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${configFileName}: the top level is not an object`] };
  }

  return parseConfigFields(fields, diagnoseUnknownKeys(configFileName, fields, configKeys));
}

/**
 * Тело записи конфига (docs/web-api.md). **Все ключи обязательны**, в отличие от чтения файла:
 * запись заменяет документ целиком, и тело без ключа молча вернуло бы настройку к умолчанию, тогда
 * как в файле у неё стояло другое значение.
 */
export function parseConfigUpdate(raw: unknown): SettingsParseResult<Config> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${configFileName}: the top level is not an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(configFileName, fields, configKeys);
  const missing = configKeys.filter((key) => fields[key] === undefined);

  if (missing.length > 0) {
    diagnostics.push(
      `${configFileName}: ${missing.join(", ")} is required: the write replaces the whole document`,
    );

    return { kind: "rejected", diagnostics };
  }

  return parseConfigFields(fields, diagnostics);
}

/** Проверка значений, общая для чтения файла и записи через API: правило у ключа одно. */
function parseConfigFields(
  fields: Record<string, unknown>,
  diagnostics: string[],
): SettingsParseResult<Config> {
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

  const maxConcurrentTurns = fields["maxConcurrentTurns"];

  if (maxConcurrentTurns !== undefined) {
    if (!Number.isInteger(maxConcurrentTurns) || (maxConcurrentTurns as number) < 1) {
      diagnostics.push(
        `${configFileName}: maxConcurrentTurns must be an integer above zero, got ${JSON.stringify(maxConcurrentTurns)}`,
      );

      return { kind: "rejected", diagnostics };
    }

    value.maxConcurrentTurns = maxConcurrentTurns as number;
  }

  const threshold = fields["compactionThreshold"];

  if (threshold !== undefined) {
    // Верхняя граница строгая: порог, равный целому окну, не сработал бы никогда — запрос к модели
    // отклонится раньше, чем контекст дорастёт до ста процентов.
    if (
      typeof threshold !== "number" ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold >= 1
    ) {
      diagnostics.push(
        `${configFileName}: compactionThreshold must be a fraction of the context window in [0, 1), got ${JSON.stringify(threshold)}`,
      );

      return { kind: "rejected", diagnostics };
    }

    value.compactionThreshold = threshold;
  }

  for (const key of [
    "compactionReserveTokens",
    "compactionKeepRecentTokens",
    "hookTimeoutMilliseconds",
    "pluginToolTimeoutMilliseconds",
    "pluginRouteTimeoutMilliseconds",
    "pluginRouteBodyLimitBytes",
    "publicRouteRequestsPerMinute",
  ] as const) {
    const tokens = fields[key];

    if (tokens === undefined) {
      continue;
    }

    if (!Number.isInteger(tokens) || (tokens as number) < 1) {
      diagnostics.push(
        `${configFileName}: ${key} must be an integer above zero, got ${JSON.stringify(tokens)}`,
      );

      return { kind: "rejected", diagnostics };
    }

    value[key] = tokens as number;
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
 * одна, файл остаётся источником истины (docs/data-directory.md).
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

  const diagnostics = diagnoseUnknownKeys(label, fields, ["colorScheme", "variant", "scale"]);
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

  const scale = fields["scale"];

  if (scale !== undefined && !isInterfaceScale(scale)) {
    diagnostics.push(
      `${label}.scale must be one of ${interfaceScales.join(", ")}, got ${JSON.stringify(scale)}`,
    );

    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: {
      colorScheme: colorScheme ?? defaultAppearance.colorScheme,
      variant: variant ?? defaultAppearance.variant,
      scale: scale ?? defaultAppearance.scale,
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

/**
 * Тело записи внешнего вида и локали. Оба ключа обязательны: запись заменяет весь раздел, и тело без
 * локали молча вернуло бы английский интерфейс человеку, который менял только тему.
 */
export function parseAppearancePreferences(
  raw: unknown,
  label = "preferences",
): SettingsParseResult<AppearancePreferences> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, ["appearance", "locale"]);

  for (const required of ["appearance", "locale"]) {
    if (fields[required] === undefined) {
      diagnostics.push(`${label}.${required} is required: the write replaces both`);

      return { kind: "rejected", diagnostics };
    }
  }

  const appearance = parseAppearance(fields["appearance"], `${label}.appearance`);

  diagnostics.push(...appearance.diagnostics);

  if (appearance.kind === "rejected") {
    return { kind: "rejected", diagnostics };
  }

  const locale = parseLocale(fields["locale"], `${label}.locale`);

  diagnostics.push(...locale.diagnostics);

  if (locale.kind === "rejected") {
    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: { appearance: appearance.value, locale: locale.value },
    diagnostics,
  };
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
 * веб-API: форма одна, файл остаётся источником истины (docs/data-directory.md), и разойтись им не на чем.
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

/**
 * Ключ режется по **последнему** двоеточию, а не по первому: у источника папки проекта их два
 * (`project:<id проекта>:<id плагина>`). Разбор однозначен — двоеточий не допускает ни
 * `pluginIdPattern`, ни идентификатор проекта (`isPluginSource`).
 */
function isPluginKey(key: string): boolean {
  const boundary = key.lastIndexOf(":");

  if (boundary === -1) {
    return false;
  }

  return isPluginSource(key.slice(0, boundary)) && pluginIdPattern.test(key.slice(boundary + 1));
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

/** Нужен и снаружи: форма конфига получает от выпадающего списка строку и обязана её сузить. */
export function isLogLevel(value: unknown): value is LogLevel {
  return logLevels.includes(value as LogLevel);
}
