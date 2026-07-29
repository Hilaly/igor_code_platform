/**
 * Запросы вью провайдеров. Каталог живёт в агентном рантайме за демоном
 * (docs/models-and-providers.md), поэтому вью только спрашивает: своей копии ни провайдеров, ни
 * моделей у него нет.
 *
 * Моделей больше тысячи на все провайдеры (docs/web-api.md), и в снимке их нет вовсе: список моделей
 * спрашивается по одному провайдеру.
 *
 * Вход разложен на три запроса — начать, ответить на шаг, отменить, — а сами шаги приезжают кадром
 * потока: диалог с провайдером не укладывается в один запрос (docs/models-and-providers.md).
 */

import {
  providerCredentialPath,
  providerLoginAnswerPath,
  providerLoginPath,
  providerLoginsPath,
  providerModelsPath,
  providersPath,
  type LoginAnswer,
  type LoginAttemptState,
  type LoginAttemptsSnapshot,
  type LoginStart,
  type ProviderModels,
  type ProviderSummary,
  type ProvidersSnapshot,
} from "@sovereign/protocol";

export async function fetchProvidersSnapshot(signal?: AbortSignal): Promise<ProvidersSnapshot> {
  const response = await fetch(providersPath, signal === undefined ? {} : { signal });

  // Негодный файл кредов сюда не приходит отказом: он приезжает полем `problem` внутри снимка
  // (docs/web-api.md). Отказ здесь означает, что не отвечает сам маршрут.
  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProvidersSnapshot;
}

export async function fetchProviderModels(
  providerId: string,
  signal?: AbortSignal,
): Promise<ProviderModels> {
  const response = await fetch(
    providerModelsPath(providerId),
    signal === undefined ? {} : { signal },
  );

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProviderModels;
}

/**
 * Идущие попытки входа. Спрашиваются на каждом подъёме соединения: кадр шага мог уехать в разрыв, и
 * диалог восстанавливается снимком, а не окном догона потока (docs/web-api.md).
 */
export async function fetchLoginAttempts(signal?: AbortSignal): Promise<LoginAttemptsSnapshot> {
  const response = await fetch(providerLoginsPath, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as LoginAttemptsSnapshot;
}

export type StartLoginOutcome =
  | { kind: "started"; attempt: LoginAttemptState }
  /**
   * В этого провайдера уже входят. Отдельный исход, а не исключение: занявшая попытка нужна вью
   * целиком — по `origin` и `answerable` видно, можно ли отвечать здесь (прецедент — `ProjectTaken`).
   */
  | { kind: "taken"; error: string; conflict: LoginAttemptState };

export async function startProviderLogin(start: LoginStart): Promise<StartLoginOutcome> {
  const response = await fetch(providerLoginsPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(start),
  });

  if (response.ok) {
    return { kind: "started", attempt: (await response.json()) as LoginAttemptState };
  }

  const failure = (await response.json().catch(() => ({}))) as {
    error?: string;
    conflict?: LoginAttemptState;
  };

  if (response.status === 409 && failure.conflict !== undefined) {
    return {
      kind: "taken",
      error: failure.error ?? "a login into this provider is already running",
      conflict: failure.conflict,
    };
  }

  throw new Error(failure.error ?? `the daemon answered ${response.status}`);
}

export type AnswerLoginOutcome =
  | { kind: "answered" }
  /**
   * Шаг больше не ждёт ответа: форма отправлена дважды либо ответ уехал на прошлый вопрос
   * (docs/web-api.md). Не исключение: человек ничего не сломал, и сказать об этом надо словами.
   */
  | { kind: "stale"; reason: string };

export async function answerLoginStep(
  attemptId: string,
  answer: LoginAnswer,
): Promise<AnswerLoginOutcome> {
  const response = await fetch(providerLoginAnswerPath(attemptId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Значение уезжает только здесь: на шаге `secret` это ключ, и хранить его сверх этого негде
    // (docs/models-and-providers.md).
    body: JSON.stringify(answer),
  });

  if (response.ok) {
    return { kind: "answered" };
  }

  const failure = (await response.json().catch(() => ({}))) as { error?: string };

  if (response.status === 409) {
    return { kind: "stale", reason: failure.error ?? "that step is no longer waiting" };
  }

  throw new Error(failure.error ?? `the daemon answered ${response.status}`);
}

export async function cancelProviderLogin(attemptId: string): Promise<void> {
  const response = await fetch(providerLoginPath(attemptId), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }
}

/**
 * Выход из провайдера. Ответ — нынешний статус провайдера, а не пустое тело: кред из окружения
 * платформе не принадлежит, убрать его нечем, и провайдер останется настроенным (docs/web-api.md).
 */
export async function logOutProvider(providerId: string): Promise<ProviderSummary> {
  const response = await fetch(providerCredentialPath(providerId), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProviderSummary;
}

/** Демон отвечает `{"error"}` на любой отказ (docs/web-api.md), но код без тела тоже возможен. */
async function reasonOf(response: Response): Promise<string> {
  const failure = (await response.json().catch(() => ({}))) as { error?: string };

  return failure.error ?? `the daemon answered ${response.status}`;
}
