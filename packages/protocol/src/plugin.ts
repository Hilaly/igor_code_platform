/**
 * Манифест плагина — поле `sovereign` в его `package.json` (docs/plugins.md). Разбор живёт в протоколе, а
 * не в демоне, потому что имена полей это публичный контракт: по ним автор пишет манифест, по ним же
 * интерфейс объясняет, почему плагин не взяли.
 *
 * Манифест читается без исполнения кода: до решения о доверии исполнять нечего.
 */

export const manifestFileName = "package.json";
export const manifestField = "sovereign";

/**
 * Версия платформы, с которой сверяется диапазон из манифеста. Единственный источник: сборка сюда
 * ничего не подставляет, смена версии — осознанное действие вместе с решением о несовместимости.
 */
export const platformVersion = "0.1.0";

/**
 * Источники с одним корнем на всю платформу (docs/plugins.md, docs/repository-structure.md).
 * Третий источник — папка проекта — корня на всех не имеет: их столько, сколько проектов, поэтому
 * он параметризован и в этот список не входит.
 */
export const staticPluginSources = ["builtin", "data"] as const;

/**
 * Источник папки проекта: `project:<id записи проекта>` (docs/plugins.md,
 * docs/sessions-and-projects.md). В ключ едет идентификатор записи, а не путь папки: путь длинный,
 * содержит пробелы и юникод, требует кодирования в URL и меняет написание от регистра.
 */
export type ProjectPluginSource = `project:${string}`;

/**
 * Источники плагинов в порядке возрастания специфичности: более специфичный перекрывает менее
 * специфичный при споре вкладов (docs/plugins.md).
 */
export type PluginSource = (typeof staticPluginSources)[number] | ProjectPluginSource;

const projectSourcePrefix = "project:";

export function projectPluginSource(projectId: string): ProjectPluginSource {
  return `${projectSourcePrefix}${projectId}`;
}

/** Какому проекту принадлежит источник. У непроектного — никакому. */
export function projectOfPluginSource(source: PluginSource): string | undefined {
  return source.startsWith(projectSourcePrefix)
    ? source.slice(projectSourcePrefix.length)
    : undefined;
}

/**
 * Ранг специфичности. Считается функцией, а не позицией в массиве: у источника проекта позиции нет
 * вовсе, и `indexOf` дал бы ему −1, то есть папка проекта проигрывала бы встроенному — молча и в
 * обратную сторону от задуманного.
 */
export function pluginSourceRank(source: PluginSource): number {
  const known = staticPluginSources.indexOf(source as (typeof staticPluginSources)[number]);

  return known === -1 ? staticPluginSources.length : known;
}

export function isPluginSource(value: unknown): value is PluginSource {
  if (typeof value !== "string") {
    return false;
  }

  if (staticPluginSources.includes(value as (typeof staticPluginSources)[number])) {
    return true;
  }

  const projectId = projectOfPluginSource(value as PluginSource);

  // Двоеточие внутри идентификатора проекта сделало бы разбор ключа неоднозначным: `project:a:b`
  // читалось бы и как плагин `b` проекта `a`, и как плагин без имени проекта `a:b`.
  return projectId !== undefined && projectId !== "" && !projectId.includes(":");
}

/**
 * Плагин, о котором в предпочтениях ещё ничего не сказано: встроенный работает сразу (docs/plugins.md),
 * любой другой ждёт явного включения — включение это граница доверия (docs/plugins.md).
 */
export function pluginEnabledByDefault(source: PluginSource): boolean {
  return source === "builtin";
}

/**
 * Идентификатор попадает и в маршрут `/api/p/<pluginId>/...`, и в адрес страницы
 * `/p/<pluginId>/...`, поэтому годятся не любые символы.
 */
export const pluginIdPattern = /^[a-z0-9][a-z0-9-]*$/;

export type PluginManifest = {
  /** Не имя npm-пакета: у имени со скоупом есть слэш, а идентификатор идёт в путь (docs/plugins.md). */
  id: string;
  /** Путь к воркерной точке входа относительно папки плагина. */
  worker: string;
  /** Путь к браузерной точке входа; плагин без интерфейса её не объявляет. */
  browser?: string;
  /** Диапазон версий платформы, с которыми плагин совместим. */
  platform: string;
};

export type PluginManifestParseResult =
  | { kind: "parsed"; value: PluginManifest; diagnostics: string[] }
  /** Папка не объявляет себя плагином: это чужой пакет, а не сломанный плагин. */
  | { kind: "absent" }
  /** Плагин объявлен, но взять его нельзя. Причина показывается человеку (docs/plugins.md). */
  | { kind: "refused"; reason: string; diagnostics: string[] };

const manifestKeys = ["id", "worker", "browser", "platform"];

export function parsePluginManifest(
  raw: unknown,
  version: string = platformVersion,
): PluginManifestParseResult {
  const packageFields = asObject(raw);

  if (packageFields === undefined) {
    return { kind: "refused", reason: `${manifestFileName} is not an object`, diagnostics: [] };
  }

  const declared = packageFields[manifestField];

  if (declared === undefined) {
    return { kind: "absent" };
  }

  const fields = asObject(declared);

  if (fields === undefined) {
    return { kind: "refused", reason: `${manifestField} is not an object`, diagnostics: [] };
  }

  // Неизвестный ключ — диагностика, а не отказ: манифест, написанный более новой платформой, обязан
  // грузиться на старой, пока обязательные поля на месте.
  const diagnostics = Object.keys(fields)
    .filter((key) => !manifestKeys.includes(key))
    .map((key) => `${manifestField}.${key} is unknown and ignored`);

  const refuse = (reason: string): PluginManifestParseResult => ({
    kind: "refused",
    reason,
    diagnostics,
  });

  const id = fields["id"];

  if (typeof id !== "string" || !pluginIdPattern.test(id)) {
    return refuse(
      `${manifestField}.id must match ${pluginIdPattern.source}, got ${JSON.stringify(id)}`,
    );
  }

  const worker = fields["worker"];
  const workerProblem = describePathProblem(worker);

  if (typeof worker !== "string" || workerProblem !== undefined) {
    return refuse(`${manifestField}.worker ${workerProblem ?? "must be a string"}`);
  }

  const browser = fields["browser"];
  const browserProblem = browser === undefined ? undefined : describePathProblem(browser);

  if (browserProblem !== undefined) {
    return refuse(`${manifestField}.browser ${browserProblem}`);
  }

  const platform = fields["platform"];

  if (typeof platform !== "string") {
    return refuse(
      `${manifestField}.platform must be a version range, got ${JSON.stringify(platform)}`,
    );
  }

  const match = matchVersionRange(platform, version);

  if (match.kind === "unreadable") {
    return refuse(`${manifestField}.platform ${match.reason}`);
  }

  if (match.kind === "differs") {
    return refuse(`the plugin requires platform ${platform}, this platform is ${version}`);
  }

  return {
    kind: "parsed",
    value: {
      id,
      worker,
      ...(typeof browser === "string" ? { browser } : {}),
      platform,
    },
    diagnostics,
  };
}

export type VersionRangeMatch =
  | { kind: "matches" }
  | { kind: "differs" }
  /** Диапазон записан не так, как мы умеем читать. Молчаливого «подходит» здесь нет. */
  | { kind: "unreadable"; reason: string };

/**
 * Своя проверка диапазона вместо зависимости: поддерживается ровно то, что нужно манифесту, —
 * `*`, точная версия, `^`, `~`, `>=`. Составные диапазоны и предрелизы не читаются намеренно:
 * платформа одна, и выбирать между её версиями плагину нечего.
 */
export function matchVersionRange(range: string, version: string): VersionRangeMatch {
  const trimmed = range.trim();

  if (trimmed === "*") {
    return { kind: "matches" };
  }

  const parts = /^(\^|~|>=)?\s*(\d+\.\d+\.\d+)$/.exec(trimmed);
  const bound = parts === null ? undefined : parseVersion(parts[2] ?? "");
  const actual = parseVersion(version);

  if (bound === undefined) {
    return {
      kind: "unreadable",
      reason: `must be *, x.y.z, ^x.y.z, ~x.y.z or >=x.y.z, got ${JSON.stringify(range)}`,
    };
  }

  if (actual === undefined) {
    return { kind: "unreadable", reason: `cannot be compared with version ${version}` };
  }

  const operator = parts?.[1] ?? "";
  const difference = compareVersions(actual, bound);
  const matches =
    operator === ""
      ? difference === 0
      : operator === ">="
        ? difference >= 0
        : difference >= 0 && compareVersions(actual, ceiling(operator, bound)) < 0;

  return matches ? { kind: "matches" } : { kind: "differs" };
}

type Version = [number, number, number];

function parseVersion(raw: string): Version | undefined {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);

  if (parts === null) {
    return undefined;
  }

  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/**
 * Верхняя граница диапазона, исключительная. `^` до первой ненулевой позиции — как в npm: на нулевом
 * мажоре ломающим считается минор, иначе `^0.1.0` разрешал бы любую версию до `1.0.0`.
 */
function ceiling(operator: string, [major, minor, patch]: Version): Version {
  if (operator === "~" || major === 0) {
    return major === 0 && minor === 0 && operator === "^"
      ? [0, 0, patch + 1]
      : [major, minor + 1, 0];
  }

  return [major + 1, 0, 0];
}

function describePathProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return "must be a non-empty path inside the plugin folder";
  }

  // Точка входа за пределами папки плагина — это не опечатка, а попытка вылезти наружу.
  const segments = value.split(/[\\/]/);

  if (value.startsWith("/") || segments.includes("..")) {
    return `must stay inside the plugin folder, got ${JSON.stringify(value)}`;
  }

  return undefined;
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}
