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
  modelAliasPath,
  modelAliasesPath,
  providerCredentialPath,
  providerKeyPath,
  providerLoginAnswerPath,
  providerLoginPath,
  providerLoginsPath,
  providerModelsPath,
  providersPath,
  userProviderPath,
  userProviderRefreshPath,
  userProvidersPath,
  type LoginAnswer,
  type LoginAttemptState,
  type LoginAttemptsSnapshot,
  type LoginStart,
  type ModelAlias,
  type ModelAliasDeleted,
  type ModelAliasesSnapshot,
  type ProviderKeyUpdate,
  type ProviderModels,
  type ProviderSummary,
  type ProvidersSnapshot,
  type UserProviderDeleted,
  type UserProviderDetails,
  type UserProviderDraft,
  type UserProvidersSnapshot,
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

export async function fetchUserProviders(signal?: AbortSignal): Promise<UserProvidersSnapshot> {
  const response = await fetch(userProvidersPath, signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(await reasonOf(response));
  return (await response.json()) as UserProvidersSnapshot;
}

export async function fetchUserProvider(
  id: string,
  signal?: AbortSignal,
): Promise<UserProviderDetails> {
  const response = await fetch(userProviderPath(id), signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(await reasonOf(response));
  return (await response.json()) as UserProviderDetails;
}

export async function createUserProvider(draft: UserProviderDraft): Promise<UserProviderDetails> {
  return writeUserProvider(userProvidersPath, "POST", draft);
}

export async function updateUserProvider(
  id: string,
  draft: UserProviderDraft,
): Promise<UserProviderDetails> {
  return writeUserProvider(userProviderPath(id), "PUT", draft);
}

export async function deleteUserProvider(id: string): Promise<UserProviderDeleted> {
  const response = await fetch(userProviderPath(id), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(await reasonOf(response));
  return (await response.json()) as UserProviderDeleted;
}

export async function refreshUserProvider(id: string): Promise<UserProviderDetails> {
  const response = await fetch(userProviderRefreshPath(id), {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(await reasonOf(response));
  return (await response.json()) as UserProviderDetails;
}

async function writeUserProvider(
  path: string,
  method: "POST" | "PUT",
  draft: UserProviderDraft,
): Promise<UserProviderDetails> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw new Error(await reasonOf(response));
  return (await response.json()) as UserProviderDetails;
}

export async function fetchModelAliases(signal?: AbortSignal): Promise<ModelAliasesSnapshot> {
  const response = await fetch(modelAliasesPath, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ModelAliasesSnapshot;
}

/** Новый алиас или замена существующего. Идентификатор у замены не меняется — маршрут откажет. */
export async function saveModelAlias(alias: ModelAlias, existing: boolean): Promise<ModelAlias> {
  const response = await fetch(existing ? modelAliasPath(alias.id) : modelAliasesPath, {
    method: existing ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(alias),
  });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ModelAlias;
}

export async function deleteModelAlias(aliasId: string): Promise<ModelAliasDeleted> {
  const response = await fetch(modelAliasPath(aliasId), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ModelAliasDeleted;
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

/**
 * Правка ключа: подпись или выбор. Ответ — провайдер целиком, а не сам ключ: статус и набор вью
 * показывает рядом, и разъехаться им нельзя (docs/web-api.md).
 */
export async function updateProviderKey(
  providerId: string,
  keyId: string,
  update: ProviderKeyUpdate,
): Promise<ProviderSummary> {
  return writeProviderKey(providerId, keyId, "PUT", update);
}

/** Убрать один ключ. Ушёл последний — провайдер станет ненастроенным, и это видно в ответе. */
export async function removeProviderKey(
  providerId: string,
  keyId: string,
): Promise<ProviderSummary> {
  return writeProviderKey(providerId, keyId, "DELETE");
}

async function writeProviderKey(
  providerId: string,
  keyId: string,
  method: "PUT" | "DELETE",
  update?: ProviderKeyUpdate,
): Promise<ProviderSummary> {
  const response = await fetch(providerKeyPath(providerId, keyId), {
    method,
    headers: { "content-type": "application/json" },
    ...(update === undefined ? {} : { body: JSON.stringify(update) }),
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
