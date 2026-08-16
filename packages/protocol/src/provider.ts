/**
 * Провайдеры LLM и их модели (docs/models-and-providers.md). Контракт лежит здесь, а не в демоне:
 * по этим же полям интерфейс рисует вью провайдеров и объясняет, почему войти нельзя.
 *
 * Ни один тип Pi наружу не выходит — граница проходит ровно здесь
 * (docs/architecture.md, docs/repository-structure.md).
 */

export const providersPath = "/api/providers";
export const userProvidersPath = "/api/user-providers";

/** Шаблоны для таблицы маршрутов демона. `:providerId` — идентификатор провайдера у рантайма. */
export const providerModelsPathPattern = `${providersPath}/:providerId/models`;
export const providerCredentialPathPattern = `${providersPath}/:providerId/credential`;
export const providerKeysPathPattern = `${providersPath}/:providerId/keys`;
export const providerKeyPathPattern = `${providerKeysPathPattern}/:keyId`;
export const userProviderPathPattern = `${userProvidersPath}/:providerId`;
export const userProviderRefreshPathPattern = `${userProviderPathPattern}/models/refresh`;

/**
 * Обновление динамических списков — одно на всех, а не по провайдеру: у рантайма `refresh()`
 * обходит все настроенные динамические провайдеры разом, а обновления одного он не умеет вовсе.
 * Разбирать его оркестрацию (обновить OAuth-токен, потом сходить в сеть, потом записать кэш) ради
 * фильтра по одному провайдеру значило бы переписать её у себя.
 */
export const providersRefreshPath = `${providersPath}/refresh`;

export function providerModelsPath(providerId: string): string {
  return `${providersPath}/${encodeURIComponent(providerId)}/models`;
}

export function providerCredentialPath(providerId: string): string {
  return `${providersPath}/${encodeURIComponent(providerId)}/credential`;
}

export function providerKeysPath(providerId: string): string {
  return `${providersPath}/${encodeURIComponent(providerId)}/keys`;
}

export function providerKeyPath(providerId: string, keyId: string): string {
  return `${providerKeysPath(providerId)}/${encodeURIComponent(keyId)}`;
}

export function userProviderPath(providerId: string): string {
  return `${userProvidersPath}/${encodeURIComponent(providerId)}`;
}

export function userProviderRefreshPath(providerId: string): string {
  return `${userProviderPath(providerId)}/models/refresh`;
}

/**
 * Способ авторизации. Их ровно два, и это не наше упрощение: у рантайма провайдер объявляет
 * `apiKey` и `oauth`, и хотя бы один обязан быть.
 */
export type ProviderAuthType = "api_key" | "oauth";

/**
 * Способ интерактивного входа, доступный человеку. Пустой список значит «войти нечем»: провайдер
 * берёт кред только из окружения. Среди встроенных провайдеров такого нет ни одного
 * (docs/runtime-checks.md, проверка 31), но у `openai-codex` нет входа по ключу — вью обязано
 * показывать доступное, а не считать ключ всегда возможным.
 */
export type ProviderLoginMethod = {
  type: ProviderAuthType;
  /** Подпись кнопки от самого провайдера: «Anthropic API key», «Sign in with SuperGrok». */
  label: string;
};

/**
 * Состояние авторизации провайдера.
 *
 * `unknown` — не «не настроен», а «сказать нечем»: файл кредов не читается. Разница видна человеку,
 * потому что чинится она по-разному (docs/data-directory.md).
 */
export type ProviderAuthState =
  | {
      kind: "configured";
      type: ProviderAuthType;
      /**
       * Откуда взялся кред, словами рантайма: `ANTHROPIC_API_KEY`, `OAuth`, `~/.aws/credentials`.
       * Кред из окружения выйти нельзя, и подпись — единственное, по чему человек это поймёт.
       */
      source?: string;
    }
  | { kind: "unconfigured" }
  | { kind: "unknown" };

export type ProviderOrigin = "builtin" | "plugin" | "user";

/**
 * Ключ провайдера глазами вью: подпись, которую дал человек, и способ авторизации. Значение креда
 * сюда не попадает никогда, и `type` берётся у рантайма — платформа форму креда не читает
 * (docs/models-and-providers.md).
 *
 * `type` может отсутствовать: кред правили руками, и рантайм не смог его разобрать. Это не то же
 * самое, что «ключа нет», и чинится по-другому.
 */
export type ProviderKeySummary = {
  id: string;
  label: string;
  type?: ProviderAuthType;
};

/** Тело правки ключа. Пустое тело — ничего не меняем, и это отказ, а не молчаливый успех. */
export type ProviderKeyUpdate = {
  label?: string;
  /** Только `true`: выбранный ключ не снимается, а заменяется другим. */
  selected?: true;
};

export type ProviderSummary = {
  id: string;
  name: string;
  baseUrl?: string;
  logins: ProviderLoginMethod[];
  auth: ProviderAuthState;
  /**
   * Ключи провайдера в порядке добавления. Пустой список — сохранённых кредов нет; провайдер при
   * этом может быть настроен из окружения, и об этом говорит `auth`.
   */
  keys: ProviderKeySummary[];
  /**
   * Каким ключом провайдер представлен целиком: проверка авторизации, обновление списка моделей,
   * обновление OAuth-токена. Сессия агента выбирает ключ сама (docs/models-and-providers.md).
   */
  selectedKey?: string;
  /**
   * Список моделей приходит из сети и обновляется `refresh`. У встроенных провайдеров такой один
   * (docs/runtime-checks.md, проверка 31); у кастомных провайдеров плагинов — сколько угодно.
   */
  dynamic: boolean;
  /** Провайдер зарегистрирован плагином и исчезнет вместе с ним (docs/models-and-providers.md). */
  custom: boolean;
  /** Кто владеет жизненным циклом определения. */
  origin: ProviderOrigin;
  /** Сколько моделей известно сейчас. Сами модели — отдельным запросом: их больше тысячи. */
  modelCount: number;
};

/**
 * Снимок провайдеров.
 *
 * `problem` — беда, из-за которой статус авторизации у всех `unknown`. Каталог провайдеров от файла
 * кредов не зависит, поэтому список отдаётся и в этом случае: пустое вью чинить файл не помогает.
 */
export type ProvidersSnapshot = {
  providers: ProviderSummary[];
  problem?: string;
};

/**
 * Цена **за миллион токенов**, как её отдаёт рантайм: `calculateCost` у Pi делит эти числа на
 * миллион. Тарифные ступени не переносятся — вью их не показывает.
 */
export type ModelCost = {
  input: number;
  output: number;
};

export type ModelSummary = {
  id: string;
  name: string;
  providerId: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  /** Что модель принимает на вход: `text`, `image`. */
  input: string[];
  cost: ModelCost;
};

export type ProviderModels = {
  providerId: string;
  models: ModelSummary[];
};

/**
 * Как разговаривать с провайдером. Перечень закрыт: это протокол API, реализацию которого даёт
 * рантайм, а на незнакомое имя ему нечем ответить (docs/models-and-providers.md).
 */
export type CustomProviderApi =
  "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

/**
 * Модель кастомного провайдера. Полей меньше, чем в `ModelSummary`: `providerId` берётся у
 * провайдера, а необязательные имеют безопасное умолчание.
 */
export type CustomModelDefinition = {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  /** По умолчанию модель не рассуждает. */
  reasoning?: boolean;
  /** Что модель принимает на вход. По умолчанию — только текст. */
  input?: ("text" | "image")[];
  /** Цена за миллион токенов. Не названа — считается нулевой. */
  cost?: ModelCost;
};

/**
 * Кастомный провайдер — **только данные** (docs/models-and-providers.md). Функций здесь нет и быть
 * не может: определение приходит от плагина через границу воркера, а она — структурное
 * клонирование.
 */
export type CustomProviderDefinition = {
  id: string;
  name: string;
  baseUrl: string;
  api: CustomProviderApi;
  /**
   * Способ ключа: подпись для интерфейса и переменные окружения, из которых кред берётся сам, если
   * сохранённого нет. Значение ключа сюда не кладут — его пишет платформа после входа.
   */
  apiKey: { label: string; environmentVariables?: string[] };
  models: CustomModelDefinition[];
};

/**
 * Итог регистрации. Занятый идентификатор — **отказ операции, а не замена**: у рантайма
 * `setProvider` перезаписывает провайдера по `id`, и встроенный подменился бы молча.
 */
export type CustomProviderOutcome = { kind: "registered" } | { kind: "taken" };

export type UserProviderModelsEndpoint =
  { kind: "default" } | { kind: "custom"; url: string } | { kind: "disabled" };

export type UserModelDefaults = {
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: ModelCost;
};

export const defaultUserModelDefinition: UserModelDefaults = {
  contextWindow: 128_000,
  maxTokens: 8_192,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0 },
};

export type UserModelOverride = Partial<UserModelDefaults> & { name?: string };

export type UserProviderDefinition = {
  id: string;
  name: string;
  baseUrl: string;
  api: CustomProviderApi;
  modelsEndpoint: UserProviderModelsEndpoint;
  modelDefaults: UserModelDefaults;
  manualModels: CustomModelDefinition[];
  modelOverrides: Record<string, UserModelOverride>;
  disabledModelIds: string[];
};

export type UserProviderDraft = UserProviderDefinition;

export type UserProviderRefreshState = RefreshOutcome & { refreshedAt: string };

export type UserProviderDetails = {
  definition: UserProviderDefinition;
  conflict?: string;
  refresh?: UserProviderRefreshState;
};

export type UserProvidersSnapshot = {
  providers: UserProviderDetails[];
  problem?: string;
};

export type UserProviderDeleted = { id: string };

export function defaultModelsUrl(api: CustomProviderApi, baseUrl: string): string {
  const url = new URL(baseUrl);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.at(-1) === "models") {
    return url.toString().replace(/\/$/, "");
  }

  if (api === "anthropic-messages" && segments.at(-1) !== "v1") {
    segments.push("v1");
  }

  segments.push("models");
  url.pathname = `/${segments.join("/")}`;

  return url.toString().replace(/\/$/, "");
}

export type ProviderKeyUpdateParseResult =
  | { kind: "parsed"; value: ProviderKeyUpdate; diagnostics: string[] }
  | { kind: "rejected"; diagnostics: string[] };

/**
 * Разбор правки ключа. Подпись вправе быть пустой строкой — это «убрать подпись», а не «не менять»:
 * различие держится тем, что поля вовсе нет.
 */
export function parseProviderKeyUpdate(raw: unknown, label = "key"): ProviderKeyUpdateParseResult {
  const fields = objectOf(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = Object.keys(fields)
    .filter((key) => key !== "label" && key !== "selected")
    .map((key) => `${label}.${key} is not recognised`);
  const update: ProviderKeyUpdate = {};

  if (fields["label"] !== undefined) {
    if (typeof fields["label"] !== "string") {
      diagnostics.push(`${label}.label must be a string`);

      return { kind: "rejected", diagnostics };
    }

    update.label = fields["label"];
  }

  if (fields["selected"] !== undefined) {
    // Снять выбор нечем: выбранный ключ у настроенного провайдера есть всегда, его можно только
    // заменить другим.
    if (fields["selected"] !== true) {
      diagnostics.push(`${label}.selected must be true or absent`);

      return { kind: "rejected", diagnostics };
    }

    update.selected = true;
  }

  if (update.label === undefined && update.selected === undefined) {
    diagnostics.push(`${label} changes nothing`);

    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: update, diagnostics };
}

export type UserProviderParseResult =
  | { kind: "parsed"; value: UserProviderDefinition; diagnostics: string[] }
  | { kind: "rejected"; diagnostics: string[] };

const providerApis: CustomProviderApi[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

const userProviderKeys = [
  "id",
  "name",
  "baseUrl",
  "api",
  "modelsEndpoint",
  "modelDefaults",
  "manualModels",
  "modelOverrides",
  "disabledModelIds",
];

export function parseUserProviderDraft(
  raw: unknown,
  label = "user provider",
): UserProviderParseResult {
  const fields = objectOf(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = Object.keys(fields)
    .filter((key) => !userProviderKeys.includes(key))
    .map((key) => `${label}.${key} is not recognised`);
  const id = textOf(fields["id"]);
  const name = textOf(fields["name"]);
  const baseUrl = safeHttpUrl(fields["baseUrl"]);
  const api = fields["api"];

  if (id === undefined || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    diagnostics.push(`${label}.id must be a lowercase provider identifier`);
  }
  if (name === undefined) diagnostics.push(`${label}.name must be a non-empty name`);
  if (baseUrl === undefined) diagnostics.push(`${label}.baseUrl must be a safe absolute HTTP URL`);
  if (!providerApis.includes(api as CustomProviderApi)) {
    diagnostics.push(`${label}.api must name a supported request format`);
  }

  const endpoint = parseModelsEndpoint(
    fields["modelsEndpoint"],
    `${label}.modelsEndpoint`,
    diagnostics,
  );
  const defaults = parseModelDefaults(
    fields["modelDefaults"] ?? defaultUserModelDefinition,
    `${label}.modelDefaults`,
    diagnostics,
  );
  const manualModels = parseManualModels(
    fields["manualModels"],
    `${label}.manualModels`,
    diagnostics,
  );
  const overrides = parseModelOverrides(
    fields["modelOverrides"],
    `${label}.modelOverrides`,
    diagnostics,
  );
  const disabled = stringArray(fields["disabledModelIds"]);

  if (disabled === undefined || new Set(disabled).size !== disabled.length) {
    diagnostics.push(`${label}.disabledModelIds must contain unique non-empty strings`);
  }

  if (
    id === undefined ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(id) ||
    name === undefined ||
    baseUrl === undefined ||
    !providerApis.includes(api as CustomProviderApi) ||
    endpoint === undefined ||
    defaults === undefined ||
    manualModels === undefined ||
    overrides === undefined ||
    disabled === undefined ||
    new Set(disabled).size !== disabled.length
  ) {
    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: {
      id,
      name,
      baseUrl,
      api: api as CustomProviderApi,
      modelsEndpoint: endpoint,
      modelDefaults: defaults,
      manualModels,
      modelOverrides: overrides,
      disabledModelIds: disabled,
    },
    diagnostics,
  };
}

function parseModelsEndpoint(
  raw: unknown,
  label: string,
  diagnostics: string[],
): UserProviderModelsEndpoint | undefined {
  const fields = objectOf(raw);
  const kind = fields?.["kind"];

  if (kind === "default" || kind === "disabled") return { kind };
  if (kind === "custom") {
    const url = safeHttpUrl(fields?.["url"]);
    if (url !== undefined) return { kind, url };
  }
  diagnostics.push(`${label} must be default, disabled, or a custom safe HTTP URL`);
  return undefined;
}

function parseModelDefaults(
  raw: unknown,
  label: string,
  diagnostics: string[],
): UserModelDefaults | undefined {
  const fields = objectOf(raw);
  const contextWindow = fields?.["contextWindow"];
  const maxTokens = fields?.["maxTokens"];
  const reasoning = fields?.["reasoning"];
  const input = stringArray(fields?.["input"]);
  const cost = objectOf(fields?.["cost"]);
  const inputCost = cost?.["input"];
  const outputCost = cost?.["output"];
  const valid =
    positiveInteger(contextWindow) &&
    positiveInteger(maxTokens) &&
    typeof reasoning === "boolean" &&
    input !== undefined &&
    input.length > 0 &&
    input.every((one): one is "text" | "image" => one === "text" || one === "image") &&
    new Set(input).size === input.length &&
    nonnegativeNumber(inputCost) &&
    nonnegativeNumber(outputCost);

  if (!valid) {
    diagnostics.push(`${label} contains invalid model defaults`);
    return undefined;
  }
  return {
    contextWindow,
    maxTokens,
    reasoning,
    input,
    cost: { input: inputCost, output: outputCost },
  };
}

function parseManualModels(
  raw: unknown,
  label: string,
  diagnostics: string[],
): CustomModelDefinition[] | undefined {
  if (!Array.isArray(raw)) {
    diagnostics.push(`${label} must be an array`);
    return undefined;
  }
  const models: CustomModelDefinition[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const fields = objectOf(raw[index]);
    const id = textOf(fields?.["id"]);
    const name = textOf(fields?.["name"]);
    const defaults = parseModelDefaults(
      { ...defaultUserModelDefinition, ...fields },
      `${label}[${index}]`,
      diagnostics,
    );
    if (id === undefined || name === undefined || defaults === undefined) {
      if (id === undefined) diagnostics.push(`${label}[${index}].id must be non-empty`);
      if (name === undefined) diagnostics.push(`${label}[${index}].name must be non-empty`);
      return undefined;
    }
    models.push({ id, name, ...defaults });
  }
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    diagnostics.push(`${label} contains duplicate model identifiers`);
    return undefined;
  }
  return models;
}

function parseModelOverrides(
  raw: unknown,
  label: string,
  diagnostics: string[],
): Record<string, UserModelOverride> | undefined {
  const fields = objectOf(raw);
  if (fields === undefined) {
    diagnostics.push(`${label} must be an object`);
    return undefined;
  }
  const result: Record<string, UserModelOverride> = {};
  for (const [id, rawOverride] of Object.entries(fields)) {
    if (id.trim() === "") {
      diagnostics.push(`${label} contains an empty model identifier`);
      return undefined;
    }
    const entry = objectOf(rawOverride);
    if (entry === undefined) {
      diagnostics.push(`${label}.${id} must be an object`);
      return undefined;
    }
    const override: UserModelOverride = {};
    if (entry["name"] !== undefined) {
      const name = textOf(entry["name"]);
      if (name === undefined) {
        diagnostics.push(`${label}.${id}.name must be non-empty`);
        return undefined;
      }
      override.name = name;
    }
    for (const key of ["contextWindow", "maxTokens"] as const) {
      if (entry[key] !== undefined) {
        if (!positiveInteger(entry[key])) {
          diagnostics.push(`${label}.${id}.${key} must be a positive integer`);
          return undefined;
        }
        override[key] = entry[key];
      }
    }
    if (entry["reasoning"] !== undefined) {
      if (typeof entry["reasoning"] !== "boolean") return invalidOverride(label, id, diagnostics);
      override.reasoning = entry["reasoning"];
    }
    if (entry["input"] !== undefined) {
      const input = stringArray(entry["input"]);
      if (input === undefined || input.some((one) => one !== "text" && one !== "image")) {
        return invalidOverride(label, id, diagnostics);
      }
      override.input = input as ("text" | "image")[];
    }
    if (entry["cost"] !== undefined) {
      const cost = objectOf(entry["cost"]);
      if (!nonnegativeNumber(cost?.["input"]) || !nonnegativeNumber(cost?.["output"])) {
        return invalidOverride(label, id, diagnostics);
      }
      override.cost = { input: cost.input, output: cost.output };
    }
    result[id] = override;
  }
  return result;
}

function invalidOverride(label: string, id: string, diagnostics: string[]): undefined {
  diagnostics.push(`${label}.${id} contains invalid model values`);
  return undefined;
}

function objectOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function textOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value === "" ? undefined : value;
}

function stringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw.map(textOf);
  return values.every((value): value is string => value !== undefined) ? values : undefined;
}

function safeHttpUrl(raw: unknown): string | undefined {
  const text = textOf(raw);
  if (text === undefined) return undefined;
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
      ? url.toString().replace(/\/$/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

function positiveInteger(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0;
}

function nonnegativeNumber(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0;
}

/**
 * Итог обновления по одному провайдеру. Ошибка провайдера — не отказ маршрута: его прежний список
 * остаётся в силе, а человеку надо сказать, что нового не приехало и почему.
 */
export type RefreshOutcome = {
  providerId: string;
  modelCount: number;
  error?: string;
};

/**
 * Итог обновления целиком. `aborted` — обход прервали (например, демон останавливается); тогда
 * часть провайдеров осталась непройденной, и это не то же самое, что «у всех получилось».
 */
export type RefreshReport = {
  refreshed: RefreshOutcome[];
  aborted: boolean;
};
