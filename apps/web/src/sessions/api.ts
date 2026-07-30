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
  sessionEntriesAfterParameter,
  sessionEntriesPath,
  sessionPath,
  sessionProjectParameter,
  sessionTurnsPath,
  sessionsPath,
  type AgentsSnapshot,
  type Session,
  type SessionDraft,
  type SessionEntriesPage,
  type SessionsSnapshot,
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
  signal?: AbortSignal,
): Promise<SessionsSnapshot> {
  const path =
    projectId === undefined
      ? sessionsPath
      : `${sessionsPath}?${sessionProjectParameter}=${encodeURIComponent(projectId)}`;
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

/** Демон отвечает `{"error"}` на любой отказ (docs/web-api.md), но код без тела тоже возможен. */
async function reasonOf(response: Response): Promise<string> {
  const failure = (await response.json().catch(() => ({}))) as { error?: string };

  return failure.error ?? `the daemon answered ${String(response.status)}`;
}
