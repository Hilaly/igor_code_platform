/**
 * Провайдеры LLM и их модели (docs/models-and-providers.md). Контракт лежит здесь, а не в демоне:
 * по этим же полям интерфейс рисует вью провайдеров и объясняет, почему войти нельзя.
 *
 * Ни один тип Pi наружу не выходит — граница проходит ровно здесь
 * (docs/architecture.md, docs/repository-structure.md).
 */

export const providersPath = "/api/providers";

/** Шаблоны для таблицы маршрутов демона. `:providerId` — идентификатор провайдера у рантайма. */
export const providerModelsPathPattern = `${providersPath}/:providerId/models`;
export const providerCredentialPathPattern = `${providersPath}/:providerId/credential`;

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

export type ProviderSummary = {
  id: string;
  name: string;
  baseUrl?: string;
  logins: ProviderLoginMethod[];
  auth: ProviderAuthState;
  /**
   * Список моделей приходит из сети и обновляется `refresh`. У встроенных провайдеров такой один
   * (docs/runtime-checks.md, проверка 31); у кастомных провайдеров плагинов — сколько угодно.
   */
  dynamic: boolean;
  /** Провайдер зарегистрирован плагином и исчезнет вместе с ним (docs/models-and-providers.md). */
  custom: boolean;
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
