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
  projectAgentsPath,
  projectFilesPath,
  sessionArchivedParameter,
  sessionBranchPath,
  sessionCompactPath,
  sessionContextPath,
  sessionEntriesAfterParameter,
  sessionEntriesPath,
  sessionEntryLabelPath,
  sessionForkPath,
  sessionMessagesPath,
  sessionNavigatePath,
  sessionPath,
  sessionProjectParameter,
  sessionStatsPath,
  sessionTurnsPath,
  sessionsPath,
  type AgentsSnapshot,
  type Session,
  type SessionBranch,
  type SessionCompactAccepted,
  type SessionContextUsage,
  type SessionDraft,
  type SessionEntriesPage,
  type SessionEntryLabelled,
  type SessionForkRequest,
  type SessionMessage,
  type SessionNavigateRequest,
  type SessionNavigated,
  type ProjectFilesSnapshot,
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

/** Каталог для черновика сессии уже разрешён в контексте выбранного проекта. */
export async function fetchProjectAgents(
  projectId: string,
  signal?: AbortSignal,
): Promise<AgentsSnapshot> {
  const response = await fetch(
    projectAgentsPath(projectId),
    signal === undefined ? {} : { signal },
  );

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as AgentsSnapshot;
}

/**
 * Файлы папки проекта для подстановки `@файл`. Отдельный запрос на каждое нажатие: список зависит от
 * набранного фрагмента, а держать в браузере копию всего дерева проекта незачем — она устарела бы
 * сразу, как только агент создаст файл.
 */
export async function fetchProjectFiles(
  projectId: string,
  query: string,
  signal?: AbortSignal,
): Promise<ProjectFilesSnapshot> {
  const response = await fetch(
    projectFilesPath(projectId, query),
    signal === undefined ? {} : { signal },
  );

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProjectFilesSnapshot;
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

/**
 * Ветка дерева: путь от записи вверх до корня. Курсора у неё нет — она читается целиком
 * (docs/sessions-and-projects.md). Без `from` читается ветка текущего листа, то есть тот разговор,
 * который увидит модель на следующем турне.
 */
export async function fetchBranch(
  sessionId: string,
  from?: string,
  signal?: AbortSignal,
): Promise<SessionBranch | undefined> {
  const response = await fetch(
    sessionBranchPath(sessionId, from),
    signal === undefined ? {} : { signal },
  );

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as SessionBranch;
}

/**
 * Заполнение контекста действующей ветки. Отдельно от статистики: та отвечает «сколько заплачено» по
 * всему файлу, эта — «сколько ещё влезет».
 */
export async function fetchContextUsage(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionContextUsage | undefined> {
  const response = await fetch(
    sessionContextPath(sessionId),
    signal === undefined ? {} : { signal },
  );

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as SessionContextUsage;
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

export type CompactionOutcome =
  { kind: "accepted"; accepted: SessionCompactAccepted } | { kind: "refused"; reason: string };

/**
 * Ручная компакция. Как и у турна, в ответе фаза: компакция идёт через ту же очередь походов к
 * модели, и при исчерпанном пределе она принята, но ещё не начата.
 *
 * Отказ здесь ожидаем и разметён исходом: занятая сессия и архивная отвечают `409`.
 */
export async function requestCompaction(
  sessionId: string,
  instructions?: string,
): Promise<CompactionOutcome> {
  const response = await fetch(sessionCompactPath(sessionId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Пустое тело — законная компакция по промпту рантайма; ключа с `undefined` в JSON не бывает,
    // но объявить отсутствие инструкций отсутствием ключа честнее, чем полагаться на сериализацию.
    body: JSON.stringify(instructions === undefined ? {} : { instructions }),
  });

  if (response.ok) {
    return { kind: "accepted", accepted: (await response.json()) as SessionCompactAccepted };
  }

  return { kind: "refused", reason: await reasonOf(response) };
}

export type NavigationOutcome =
  { kind: "navigated"; navigated: SessionNavigated } | { kind: "refused"; reason: string };

/** Переход к записи дерева. `summarize` заказывает пересказ покидаемой ветки — это поход к модели. */
export async function navigateTo(
  sessionId: string,
  request: SessionNavigateRequest,
): Promise<NavigationOutcome> {
  const response = await fetch(sessionNavigatePath(sessionId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  if (response.ok) {
    return { kind: "navigated", navigated: (await response.json()) as SessionNavigated };
  }

  return { kind: "refused", reason: await reasonOf(response) };
}

export type LabelOutcome =
  { kind: "labelled"; labelled: SessionEntryLabelled } | { kind: "refused"; reason: string };

/**
 * Метка на записи. `null` снимает её, и снятие пишется явно: отсутствующий ключ значил бы «не
 * трогать», а «не трогать» у записи, которая заменяет запись целиком, — не операция.
 *
 * `PUT`, как и у самой сессии: тело здесь тоже заменяет запись целиком, а не дописывает к ней.
 */
export async function setEntryLabel(
  sessionId: string,
  entryId: string,
  label: string | null,
): Promise<LabelOutcome> {
  const response = await fetch(sessionEntryLabelPath(sessionId, entryId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });

  if (response.ok) {
    return { kind: "labelled", labelled: (await response.json()) as SessionEntryLabelled };
  }

  return { kind: "refused", reason: await reasonOf(response) };
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
