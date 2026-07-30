/**
 * Запросы вью сессий. Источник истины — демон: вью не держит своей копии ни списка сессий, ни их
 * записей, а спрашивает (docs/sessions-and-projects.md).
 *
 * Ожидаемый отказ — размеченный исход, а не исключение: причина `409` («сессия занята», «проект в
 * архиве», «модели нет в каталоге») это то, что вью показывает человеку, а не то, на чём падает.
 * Исключение остаётся за неожиданным — упавшим демоном и сломанным ответом.
 */

import {
  agentsPath,
  sessionArchivedParameter,
  sessionEntriesAfterParameter,
  sessionEntriesPath,
  sessionForkPath,
  sessionMessagesPath,
  sessionPath,
  sessionProjectParameter,
  sessionStatsPath,
  sessionTurnsPath,
  sessionsPath,
  type AgentsSnapshot,
  type Session,
  type SessionDraft,
  type SessionEntriesPage,
  type SessionForkRequest,
  type SessionMessage,
  type SessionsSnapshot,
  type SessionStats,
  type SessionUpdate,
  type TurnAccepted,
  type TurnInterrupted,
  type TurnRequest,
} from "@sovereign/protocol";

export async function fetchAgents(signal?: AbortSignal): Promise<AgentsSnapshot> {
  const response = await fetch(agentsPath, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as AgentsSnapshot;
}

export async function fetchSessions(
  projectId?: string,
  archived = false,
  signal?: AbortSignal,
): Promise<SessionsSnapshot> {
  const query = new URLSearchParams();

  if (projectId !== undefined) {
    query.set(sessionProjectParameter, projectId);
  }

  if (archived) {
    query.set(sessionArchivedParameter, "true");
  }

  const path = query.size === 0 ? sessionsPath : `${sessionsPath}?${query.toString()}`;
  const response = await fetch(path, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as SessionsSnapshot;
}

/**
 * Пропавшая сессия — не ошибка: ссылку могли открыть после того, как проект ушёл в архив, а адрес
 * остался в закладках. Вью показывает это пустой панелью, а не отказом.
 */
export async function fetchSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<Session | undefined> {
  const response = await fetch(sessionPath(sessionId), signal === undefined ? {} : { signal });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as Session;
}

/** Курсор `after` — то самое `seen` из прошлой страницы, а не длина уже показанного списка. */
export async function fetchEntries(
  sessionId: string,
  after: number,
  signal?: AbortSignal,
): Promise<SessionEntriesPage | undefined> {
  const path = `${sessionEntriesPath(sessionId)}?${sessionEntriesAfterParameter}=${String(after)}`;
  const response = await fetch(path, signal === undefined ? {} : { signal });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as SessionEntriesPage;
}

export type CreateSessionOutcome =
  | { kind: "created"; session: Session }
  /** Причина от демона английской фразой: она уходит в диагностику как есть (docs/web-api.md). */
  | { kind: "refused"; reason: string };

export async function createSession(draft: SessionDraft): Promise<CreateSessionOutcome> {
  const response = await fetch(sessionsPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });

  if (response.ok) {
    return { kind: "created", session: (await response.json()) as Session };
  }

  return { kind: "refused", reason: await reasonOf(response) };
}

export type SubmitTurnOutcome =
  { kind: "accepted"; accepted: TurnAccepted } | { kind: "refused"; reason: string };

export async function submitTurn(
  sessionId: string,
  request: TurnRequest,
): Promise<SubmitTurnOutcome> {
  const response = await fetch(sessionTurnsPath(sessionId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  if (response.ok) {
    return { kind: "accepted", accepted: (await response.json()) as TurnAccepted };
  }

  return { kind: "refused", reason: await reasonOf(response) };
}

/**
 * Прерывание. `interrupted: false` — «прерывать было нечего», и ошибкой это не является: турн мог
 * закончиться сам между нажатием и запросом.
 */
export async function interruptTurn(sessionId: string): Promise<TurnInterrupted | undefined> {
  // Заголовок нужен и здесь: у `DELETE` тела нет, но диспетчер требует его от всякого изменяющего
  // запроса (docs/web-api.md) — двойной замок против межсайтового запроса.
  const response = await fetch(sessionTurnsPath(sessionId), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as TurnInterrupted;
}

/**
 * Статистика открытой сессии. Отдельным запросом, а не полем списка: цифры нужны на той сессии, что
 * открыта, и снимок списка из полусотни строк от них не тяжелеет (docs/web-api.md).
 */
export async function fetchStats(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionStats | undefined> {
  const response = await fetch(sessionStatsPath(sessionId), signal === undefined ? {} : { signal });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as SessionStats;
}

/** Исход изменяющей операции над сессией. Отказ `409` — то, что показывают, а не то, на чём падают. */
export type SessionOutcome =
  { kind: "done"; session: Session } | { kind: "refused"; reason: string };

/** Переименование, архивация и восстановление — одна запись целой записи (docs/web-api.md). */
export async function updateSession(
  sessionId: string,
  update: SessionUpdate,
): Promise<SessionOutcome> {
  return writing(sessionPath(sessionId), "PUT", update);
}

/** Форк. Пустое тело — форк сессии целиком. */
export async function forkSession(
  sessionId: string,
  request: SessionForkRequest = {},
): Promise<SessionOutcome> {
  return writing(sessionForkPath(sessionId), "POST", request);
}

export type RemoveSessionOutcome = { kind: "removed" } | { kind: "refused"; reason: string };

export async function removeSession(sessionId: string): Promise<RemoveSessionOutcome> {
  const response = await fetch(sessionPath(sessionId), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });

  return response.ok ? { kind: "removed" } : { kind: "refused", reason: await reasonOf(response) };
}

export type SendMessageOutcome = { kind: "accepted" } | { kind: "refused"; reason: string };

/** Сообщение, которое не запускает турн: стиринг, догоняющее, к следующему турну, дозапись. */
export async function sendMessage(
  sessionId: string,
  message: SessionMessage,
): Promise<SendMessageOutcome> {
  const response = await fetch(sessionMessagesPath(sessionId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });

  return response.ok ? { kind: "accepted" } : { kind: "refused", reason: await reasonOf(response) };
}

/** Запись, отдающая сессию в ответ. Форма запроса у форка и изменения одна, различается только тело. */
async function writing(path: string, method: string, body: unknown): Promise<SessionOutcome> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return { kind: "done", session: (await response.json()) as Session };
  }

  return { kind: "refused", reason: await reasonOf(response) };
}

/** Демон отвечает `{"error"}` на любой отказ (docs/web-api.md), но код без тела тоже возможен. */
async function reasonOf(response: Response): Promise<string> {
  const failure = (await response.json().catch(() => ({}))) as { error?: string };

  return failure.error ?? `the daemon answered ${String(response.status)}`;
}
