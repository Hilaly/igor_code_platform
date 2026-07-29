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
export const providerRefreshPathPattern = `${providersPath}/:providerId/refresh`;
export const providerCredentialPathPattern = `${providersPath}/:providerId/credential`;

export function providerModelsPath(providerId: string): string {
  return `${providersPath}/${encodeURIComponent(providerId)}/models`;
}

export function providerRefreshPath(providerId: string): string {
  return `${providersPath}/${encodeURIComponent(providerId)}/refresh`;
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
 * Итог `refresh`. Ошибка провайдера — не отказ маршрута: список остаётся прежним, а человеку надо
 * сказать, что нового не приехало и почему.
 */
export type RefreshOutcome = {
  providerId: string;
  modelCount: number;
  error?: string;
};
