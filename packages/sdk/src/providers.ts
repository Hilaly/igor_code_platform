/**
 * Провайдеры LLM и их модели глазами плагина (docs/models-and-providers.md).
 *
 * **SDK отдаёт операции, а не значения.** Значение креда через него не читается и не записывается
 * никогда: единственный писатель кредов — платформа, и причина не в защите, а в сериализации записи
 * OAuth-токена. Ни метода, ни поля со значением креда здесь нет.
 *
 * Типы ниже — **своя копия** типов протокола, ровно как `PluginLogLevel`: SDK ставится извне и
 * внутренних пакетов не тянет. Копия обязана совпадать с протоколом до поля, и расхождение ловится
 * тождеством в мосте демона (`apps/daemon/src/plugin-providers.ts`): там присваивание идёт в обе
 * стороны, поэтому разъехавшиеся копии перестают компилироваться.
 */

import { currentPluginHost } from "./host.ts";

/** Способ авторизации. Их ровно два: провайдер объявляет `apiKey` и `oauth`, хотя бы один. */
export type ProviderAuthType = "api_key" | "oauth";

/** Способ интерактивного входа. Пустой список значит «войти нечем»: кред только из окружения. */
export type ProviderLoginMethod = {
  type: ProviderAuthType;
  /** Подпись от самого провайдера: «Anthropic API key», «Sign in with SuperGrok». */
  label: string;
};

/**
 * Состояние авторизации. `unknown` — не «не настроен», а «сказать нечем»: файл кредов не читается.
 */
export type ProviderAuthState =
  | {
      kind: "configured";
      type: ProviderAuthType;
      /** Откуда взялся кред, словами платформы: `ANTHROPIC_API_KEY`, `OAuth`. Не сам кред. */
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
  /** Список моделей приходит из сети и обновляется `refresh`. */
  dynamic: boolean;
  /** Провайдер зарегистрирован плагином и исчезнет вместе с ним. */
  custom: boolean;
  /** Сколько моделей известно сейчас. Сами модели — отдельным вызовом: их больше тысячи. */
  modelCount: number;
};

/** Цена **за миллион токенов**, как её считает платформа. */
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

/** Итог обновления по одному провайдеру: ошибка одного не отменяет успех остальных. */
export type RefreshOutcome = {
  providerId: string;
  modelCount: number;
  error?: string;
};

/** `aborted` — обход прервали, и часть провайдеров осталась непройденной. */
export type RefreshReport = {
  refreshed: RefreshOutcome[];
  aborted: boolean;
};

/**
 * Запрос к платформе. Это **единственная пара «запрос-ответ»** в канале плагина, и она ограничена
 * провайдерами намеренно: общего RPC у платформы нет (docs/plugins.md).
 */
export type ProviderRequest =
  | { kind: "list" }
  | { kind: "models"; providerId: string }
  | { kind: "status"; providerId: string }
  | { kind: "refresh" };

export type ProviderResponse =
  | { kind: "list"; providers: ProviderSummary[] }
  /** Провайдера нет — моделей нет: `undefined` отличается от пустого списка. */
  | { kind: "models"; models?: ModelSummary[] }
  | { kind: "status"; status?: ProviderAuthState }
  | { kind: "refresh"; report: RefreshReport }
  /** Операция не удалась. Причина приходит словами платформы и показывается автору как есть. */
  | { kind: "failed"; reason: string };

/**
 * Спросить платформу и разобрать ответ. Несовпадение вида ответа — не «пусто», а поломка канала:
 * молчаливое `undefined` увело бы автора плагина искать ошибку у себя.
 */
async function ask<Kind extends ProviderResponse["kind"]>(
  request: ProviderRequest,
  expected: Kind,
): Promise<Extract<ProviderResponse, { kind: Kind }>> {
  const response = await currentPluginHost().providers(request);

  if (response.kind === "failed") {
    throw new Error(response.reason);
  }

  if (response.kind !== expected) {
    throw new Error(`the platform answered ${response.kind} to a ${expected} request`);
  }

  return response as Extract<ProviderResponse, { kind: Kind }>;
}

export const providers = {
  /** Все провайдеры со статусом авторизации. Моделей здесь нет: их больше тысячи. */
  list: async (): Promise<ProviderSummary[]> => (await ask({ kind: "list" }, "list")).providers,

  /** Модели одного провайдера. `undefined` — такого провайдера нет. */
  models: async (providerId: string): Promise<ModelSummary[] | undefined> =>
    (await ask({ kind: "models", providerId }, "models")).models,

  /** Статус авторизации одного провайдера. `undefined` — такого провайдера нет. */
  status: async (providerId: string): Promise<ProviderAuthState | undefined> =>
    (await ask({ kind: "status", providerId }, "status")).status,

  /**
   * Перечитать динамические списки моделей. Обновления по одному провайдеру нет: рантайм обходит
   * все настроенные динамические провайдеры разом (docs/models-and-providers.md).
   */
  refresh: async (): Promise<RefreshReport> => (await ask({ kind: "refresh" }, "refresh")).report,
};
