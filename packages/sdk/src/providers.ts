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

/** Вариант выбора в шаге `select`. Ответом уезжает `id`, а не подпись. */
export type LoginOption = {
  id: string;
  label: string;
  description?: string;
};

/**
 * Вопрос, на который платформа ждёт ответа. Видов четыре, ровно как у рантайма.
 *
 * `stepId` меняется на каждый вопрос: ответ на позавчерашний шаг обязан быть отличим от ответа на
 * нынешний.
 */
export type LoginPrompt = { stepId: string; message: string } & (
  | { kind: "text"; placeholder?: string }
  /** Ответ — секрет: ключ API. В журнал он не попадает никогда. */
  | { kind: "secret"; placeholder?: string }
  | { kind: "select"; options: LoginOption[] }
  /** Код, который человек забирает у провайдера руками и приносит обратно. */
  | { kind: "manual-code"; placeholder?: string }
);

export type LoginLink = {
  url: string;
  label?: string;
};

/** Сообщение по ходу входа, на которое отвечать не надо. Видов тоже четыре. */
export type LoginNotice =
  | { kind: "info"; message: string; links?: LoginLink[] }
  /** Ссылка, по которой человек входит у провайдера. */
  | { kind: "auth-url"; url: string; instructions?: string }
  /** Код устройства: человек вводит его на странице провайдера. */
  | {
      kind: "device-code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { kind: "progress"; message: string };

/** Чем кончилась попытка. Причина отказа приходит от провайдера и показывается как есть. */
export type LoginConclusion =
  { kind: "succeeded" } | { kind: "cancelled" } | { kind: "failed"; reason: string };

/**
 * Шаг входа, приходящий плагину по ходу операции. Конца здесь нет: чем кончился вход, говорит
 * `login()`, вернув `LoginConclusion`, — иначе у одного результата было бы два места.
 */
export type LoginStep =
  { kind: "prompt"; prompt: LoginPrompt } | { kind: "notice"; notice: LoginNotice };

/**
 * Как плагин ведёт диалог входа. Шаги — часть контракта самой операции, а не отдельный поток: у
 * вопроса обязан быть тот же адресат, что у вызова (docs/models-and-providers.md).
 */
export type LoginDialogue = {
  /** Вопрос: вернуть ответ. Отказ обещания отменяет вход целиком. */
  ask: (prompt: LoginPrompt) => string | Promise<string>;
  /** Сообщение по ходу входа. Плагину, которому нечего с ним делать, метод не нужен. */
  tell?: (notice: LoginNotice) => void;
};

export type LoginInput = {
  providerId: string;
  /** То, что провайдер объявил в `logins`. */
  method: ProviderAuthType;
  dialogue: LoginDialogue;
};

/**
 * Запрос к платформе. Это **единственная пара «запрос-ответ»** в канале плагина, и она ограничена
 * провайдерами намеренно: общего RPC у платформы нет (docs/plugins.md).
 */
export type ProviderRequest =
  | { kind: "list" }
  | { kind: "models"; providerId: string }
  | { kind: "status"; providerId: string }
  | { kind: "refresh" }
  /** Диалога здесь нет: функции границу воркера не переживают, шаги едут отдельными сообщениями. */
  | { kind: "login"; providerId: string; method: ProviderAuthType }
  | { kind: "logout"; providerId: string };

export type ProviderResponse =
  | { kind: "list"; providers: ProviderSummary[] }
  /** Провайдера нет — моделей нет: `undefined` отличается от пустого списка. */
  | { kind: "models"; models?: ModelSummary[] }
  | { kind: "status"; status?: ProviderAuthState }
  | { kind: "refresh"; report: RefreshReport }
  /** Ответ приходит в конце диалога: до него плагин получает шаги. */
  | { kind: "login"; conclusion: LoginConclusion }
  | { kind: "logout" }
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

  /**
   * Провести вход целиком. Вопросы платформы приходят в `dialogue`, обещание разрешается концом
   * диалога — удачей, отменой или отказом провайдера. Кред пишет платформа, плагину он не отдаётся.
   *
   * В одного провайдера входят по одному: пока идёт чужая попытка, вызов отказывается ошибкой.
   */
  login: (input: LoginInput): Promise<LoginConclusion> => currentPluginHost().login(input),

  /** Выход. Кред из окружения этим не убрать: он не наш, и провайдер останется настроенным. */
  logout: async (providerId: string): Promise<void> => {
    await ask({ kind: "logout", providerId }, "logout");
  },
};
