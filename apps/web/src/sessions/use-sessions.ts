/**
 * Связь вью сессий с демоном: список и агенты на подъёме соединения, записи открытой сессии по её
 * адресу, турн и прерывание по нажатию. Своего потока вью не открывает — соединение одно на вкладку
 * (docs/web-api.md).
 *
 * Дельты турна приезжают не шиной, а отдельным кадром того же соединения: их сотни на один ответ
 * модели, и на шину они не выходят (docs/sessions-and-projects.md). Поэтому кадр приходит сюда
 * вызовом `receiveSessionDelta`, как шаг входа во вью провайдеров.
 */

import type {
  SessionDeltaFrame,
  SessionDraft,
  SessionForkRequest,
  SessionMessage,
  SessionNavigateRequest,
  SessionUpdate,
} from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { fetchProjectsSnapshot } from "../projects/api.ts";
import { fetchProviderModels, fetchProvidersSnapshot } from "../providers/api.ts";
import {
  createSession as createSessionRequest,
  fetchAgents,
  fetchBranch,
  fetchContextUsage,
  fetchEntries,
  fetchSession,
  fetchSessions,
  fetchStats,
  forkSession as forkSessionRequest,
  interruptTurn,
  navigateTo,
  removeSession as removeSessionRequest,
  requestCompaction,
  sendMessage as sendMessageRequest,
  setEntryLabel as setEntryLabelRequest,
  submitTurn as submitTurnRequest,
  updateSession as updateSessionRequest,
  type CreateSessionOutcome,
  type NavigationOutcome,
  type RemoveSessionOutcome,
  type SessionOutcome,
} from "./api.ts";
import {
  applyAgents,
  applyBranch,
  applyContext,
  applyEntries,
  applyFailure,
  applyStats,
  applyModels,
  applyModelsFailure,
  applyPendingTurn,
  applySessionDelta,
  applyProjects,
  applyProviders,
  applySessions,
  applyStreamEvent,
  applySummary,
  applyTurnFailure,
  closeSession,
  initialSessionsState,
  openSession,
  reconnected,
  showArchived as showArchivedIn,
  startModels,
  type SessionsState,
} from "./state.ts";

export type UseSessionsOptions = {
  bus: Pick<FrontendBus, "subscribe">;
  stream: StreamStatus;
  /** Открытая сессия приходит из адреса: маршрут — источник истины, а не состояние вью. */
  sessionId?: string;
  onDiagnostic: (diagnostic: string) => void;
};

export type SessionsController = {
  state: SessionsState;
  createSession: (draft: SessionDraft) => Promise<CreateSessionOutcome>;
  /** Подготовить диалог создания: проекты и настроенные провайдеры. Зовётся по его открытию. */
  prepareDraft: () => void;
  /** Модели одного провайдера. Все сразу не спрашиваем: их больше тысячи (docs/web-api.md). */
  loadModels: (providerId: string) => void;
  submitTurn: (text: string) => void;
  /** Сообщение, которое не запускает турн. Отказ приезжает причиной, а не исключением. */
  sendMessage: (message: SessionMessage) => Promise<string | undefined>;
  interrupt: () => void;
  /** Свернуть контекст руками. Инструкции пересказа необязательны. Возвращает причину отказа. */
  compact: (instructions?: string) => Promise<string | undefined>;
  /** Спросить ветку открытой сессии. Зовётся по открытию панели дерева, как `prepareDraft`. */
  loadBranch: () => void;
  /** Перейти к записи дерева. Ответ несёт `editorText` — его подставляет в композер вызывающий. */
  navigate: (request: SessionNavigateRequest) => Promise<NavigationOutcome>;
  /** Пометить запись или снять метку (`null`). Возвращает причину отказа. */
  setEntryLabel: (entryId: string, label: string | null) => Promise<string | undefined>;
  /** Переименование, архивация и восстановление. Возвращает причину отказа, если демон отказал. */
  updateSession: (sessionId: string, update: SessionUpdate) => Promise<string | undefined>;
  removeSession: (sessionId: string) => Promise<string | undefined>;
  /** Форк открытой сессии от записи. Новая сессия открывается сразу: смотреть на неё и есть смысл. */
  forkSession: (request: SessionForkRequest) => Promise<SessionOutcome>;
  /** Переключить список между действующими и архивными. */
  setShowArchived: (archived: boolean) => void;
  /** Кадр дельты из потока. Не событие шины (docs/sessions-and-projects.md). */
  receiveSessionDelta: (frame: SessionDeltaFrame) => void;
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function useSessions(options: UseSessionsOptions): SessionsController {
  const { bus, stream, sessionId, onDiagnostic } = options;
  const [state, setState] = useState<SessionsState>(initialSessionsState);

  // То же зеркало, что во вью провайдеров: правило смотрит на предыдущее состояние, а дельты
  // приходят чаще, чем React успевает отрисовать. Единственный источник изменения — `apply`.
  const latest = useRef<SessionsState>(initialSessionsState);
  const apply = useCallback((next: (current: SessionsState) => SessionsState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  const pendingSessions = useRef<AbortController | undefined>(undefined);
  const pendingAgents = useRef<AbortController | undefined>(undefined);
  const pendingOpen = useRef<AbortController | undefined>(undefined);

  const reloadSessions = useCallback(() => {
    pendingSessions.current?.abort();

    const controller = new AbortController();
    pendingSessions.current = controller;

    void fetchSessions(undefined, latest.current.showArchived, controller.signal)
      .then((snapshot) => apply((current) => applySessions(current, snapshot)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the sessions could not be read: ${reason}`);
        apply((current) => applyFailure(current, reason));
      });
  }, [apply, onDiagnostic]);

  const reloadAgents = useCallback(() => {
    pendingAgents.current?.abort();

    const controller = new AbortController();
    pendingAgents.current = controller;

    void fetchAgents(controller.signal)
      .then((snapshot) => apply((current) => applyAgents(current, snapshot.agents)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        // Список сессий от агентов не зависит: без них нельзя создать новую, но не читать старые.
        onDiagnostic(`the agents could not be read: ${reasonOf(cause)}`);
      });
  }, [apply, onDiagnostic]);

  /**
   * Снимок открытой сессии, её записи, счёт и заполнение контекста. Спрашиваются вместе и под одной
   * отменой на всех: порознь они разошлись бы — фаза из одного ответа, записи из другого. Контекст
   * едет здесь же, потому что меняется он тогда же, когда фаза: турн дописал ветку или её свернули.
   *
   * Курсор берётся из состояния: после переподъёма он обнулён, и история читается заново. Ветка
   * спрашивается здесь же: без неё лента не может скрыть брошенные попытки до открытия дерева.
   */
  const reloadOpen = useCallback(() => {
    const open = latest.current.open;

    if (open === undefined) {
      return;
    }

    pendingOpen.current?.abort();

    const controller = new AbortController();
    pendingOpen.current = controller;
    const { id, seen } = open;

    void Promise.all([
      fetchSession(id, controller.signal),
      fetchEntries(id, seen, controller.signal),
      fetchBranch(id, undefined, controller.signal),
      fetchStats(id, controller.signal),
      fetchContextUsage(id, controller.signal),
    ])
      .then(([summary, page, branch, stats, context]) => {
        apply((current) => applySummary(current, id, summary));
        apply((current) => applyBranch(current, id, branch));
        apply((current) => applyStats(current, id, stats));
        apply((current) => applyContext(current, id, context));

        if (page !== undefined) {
          apply((current) => applyEntries(current, id, page.entries, page.seen));
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the session ${id} could not be read: ${reason}`);
        apply((current) => applyTurnFailure(current, id, reason));
      });
  }, [apply, onDiagnostic]);

  // Порядок эффектов важен: сначала состояние узнаёт про адрес, потом по нему идут запросы.
  useEffect(() => {
    apply((current) =>
      sessionId === undefined ? closeSession(current) : openSession(current, sessionId),
    );
  }, [apply, sessionId]);

  useEffect(() => {
    if (stream !== "open") {
      return;
    }

    // Подъём соединения — это и первое открытие, и возврат после разрыва. Различать их незачем:
    // дельты разрыва не догоняются, и в обоих случаях правильный ход один — спросить заново.
    apply(reconnected);
    reloadSessions();
    reloadAgents();
    reloadOpen();
  }, [apply, reloadAgents, reloadOpen, reloadSessions, sessionId, stream]);

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      const outcome = applyStreamEvent(latest.current, event);

      apply(() => outcome.state);

      if (outcome.sessions) {
        reloadSessions();
        reloadOpen();
      }
    });

    return unsubscribe;
  }, [apply, bus, reloadOpen, reloadSessions]);

  useEffect(
    () => () => {
      pendingSessions.current?.abort();
      pendingAgents.current?.abort();
      pendingOpen.current?.abort();
    },
    [],
  );

  const prepareDraft = useCallback(() => {
    void fetchProjectsSnapshot()
      .then((snapshot) => apply((current) => applyProjects(current, snapshot.projects)))
      .catch((cause: unknown) =>
        onDiagnostic(`the projects could not be read: ${reasonOf(cause)}`),
      );

    void fetchProvidersSnapshot()
      .then((snapshot) => apply((current) => applyProviders(current, snapshot.providers)))
      .catch((cause: unknown) =>
        onDiagnostic(`the providers could not be read: ${reasonOf(cause)}`),
      );
  }, [apply, onDiagnostic]);

  const loadModels = useCallback(
    (providerId: string) => {
      // Прочитанное не перечитывается: каталог моделей лежит в пакете рантайма и сам не меняется.
      const known = latest.current.models[providerId];

      if (known?.kind === "ready" || known?.kind === "loading") {
        return;
      }

      apply((current) => startModels(current, providerId));

      void fetchProviderModels(providerId)
        .then((answer) => apply((current) => applyModels(current, providerId, answer.models)))
        .catch((cause: unknown) => {
          const reason = reasonOf(cause);

          onDiagnostic(`the models of ${providerId} could not be read: ${reason}`);
          apply((current) => applyModelsFailure(current, providerId, reason));
        });
    },
    [apply, onDiagnostic],
  );

  const createSession = useCallback(
    async (draft: SessionDraft): Promise<CreateSessionOutcome> => {
      const outcome = await createSessionRequest(draft).catch(
        (cause: unknown): CreateSessionOutcome => ({ kind: "refused", reason: reasonOf(cause) }),
      );

      if (outcome.kind === "refused") {
        // Причина от демона английской фразой уходит в диагностику как есть; человеку вью покажет
        // переведённое — так же, как в остальных вью.
        onDiagnostic(`the session could not be created: ${outcome.reason}`);
      }

      return outcome;
    },
    [onDiagnostic],
  );

  const submitTurn = useCallback(
    (text: string) => {
      const id = latest.current.open?.id;

      if (id === undefined) {
        return;
      }

      void submitTurnRequest(id, { text })
        .then((outcome) => {
          if (outcome.kind === "refused") {
            onDiagnostic(`the turn was refused: ${outcome.reason}`);
            apply((current) => applyTurnFailure(current, id, outcome.reason));

            return;
          }

          // Текст показывается сразу — но только у турна, вставшего в очередь: он не даёт ни одной
          // дельты, и без этого реплика ждала бы конца чужого турна. У начатого турна запись уже
          // пишется, и вторая копия реплики висела бы в ленте до самого конца работы.
          if (outcome.accepted.phase === "queued") {
            apply((current) => applyPendingTurn(current, id, outcome.accepted.turnId, text));
          }
          apply((current) =>
            applySummary(
              current,
              id,
              current.open?.summary === undefined
                ? undefined
                : { ...current.open.summary, phase: outcome.accepted.phase },
            ),
          );
        })
        .catch((cause: unknown) => {
          const reason = reasonOf(cause);

          onDiagnostic(`the turn could not be submitted: ${reason}`);
          apply((current) => applyTurnFailure(current, id, reason));
        });
    },
    [apply, onDiagnostic],
  );

  const interrupt = useCallback(() => {
    const id = latest.current.open?.id;

    if (id === undefined) {
      return;
    }

    // Исход не выдумывается: прерванный турн отзовётся дельтой `turn-aborted`, а снятый с очереди —
    // событием `core.sessions.changed`. Оба пути ведут к перечитыванию снимка.
    void interruptTurn(id).catch((cause: unknown) => {
      const reason = reasonOf(cause);

      onDiagnostic(`the turn could not be interrupted: ${reason}`);
      apply((current) => applyTurnFailure(current, id, reason));
    });
  }, [apply, onDiagnostic]);

  const receiveSessionDelta = useCallback(
    (frame: SessionDeltaFrame) => {
      const outcome = applySessionDelta(latest.current, frame.sessionId, frame.turnId, frame.delta);

      apply(() => outcome.state);

      if (outcome.reread) {
        reloadOpen();
      }
    },
    [apply, reloadOpen],
  );

  const sendMessage = useCallback(
    async (message: SessionMessage): Promise<string | undefined> => {
      const id = latest.current.open?.id;

      if (id === undefined) {
        return undefined;
      }

      const outcome = await sendMessageRequest(id, message).catch((cause: unknown) => ({
        kind: "refused" as const,
        reason: reasonOf(cause),
      }));

      if (outcome.kind === "refused") {
        onDiagnostic(`the message was refused: ${outcome.reason}`);

        return outcome.reason;
      }

      reloadOpen();

      return undefined;
    },
    [onDiagnostic, reloadOpen],
  );

  /**
   * Ручная компакция. Отказ возвращается причиной, а не исключением: занятая и архивная сессии
   * отвечают `409`, и это то, что показывают человеку.
   */
  const compact = useCallback(
    async (instructions?: string): Promise<string | undefined> => {
      const id = latest.current.open?.id;

      if (id === undefined) {
        return undefined;
      }

      const outcome = await requestCompaction(id, instructions).catch((cause: unknown) => ({
        kind: "refused" as const,
        reason: reasonOf(cause),
      }));

      if (outcome.kind === "refused") {
        onDiagnostic(`the compaction of ${id} was refused: ${outcome.reason}`);

        return outcome.reason;
      }

      // Фаза из ответа применяется сразу, как у турна: компакция — поход к модели, и при исчерпанном
      // пределе она принята, но ещё не начата. Записи здесь не дочитываются: пересказ появится в
      // дереве только к концу компакции, а её конец приедет событием шины — оно и перечитает.
      apply((current) =>
        applySummary(
          current,
          id,
          current.open?.summary === undefined
            ? undefined
            : { ...current.open.summary, phase: outcome.accepted.phase },
        ),
      );

      return undefined;
    },
    [apply, onDiagnostic],
  );

  /**
   * Ветка сессии. Спрашивается по открытию панели дерева, а не вместе со снимком: ответ несёт весь
   * путь до листа, и возить его на каждом событии шины значило бы платить за него всё время, пока
   * панель закрыта. Из ответа применяется только лист.
   */
  const loadBranch = useCallback(() => {
    const id = latest.current.open?.id;

    if (id === undefined) {
      return;
    }

    void fetchBranch(id)
      .then((branch) => apply((current) => applyBranch(current, id, branch)))
      .catch((cause: unknown) =>
        onDiagnostic(`the branch of ${id} could not be read: ${reasonOf(cause)}`),
      );
  }, [apply, onDiagnostic]);

  /**
   * Переход к записи дерева. Лист после него другой, поэтому перечитываются и лента, и ветка: всё
   * показанное относится теперь к другому разговору.
   */
  const navigate = useCallback(
    async (request: SessionNavigateRequest): Promise<NavigationOutcome> => {
      const id = latest.current.open?.id;

      if (id === undefined) {
        return { kind: "refused", reason: "no session is open" };
      }

      const outcome = await navigateTo(id, request).catch((cause: unknown) => ({
        kind: "refused" as const,
        reason: reasonOf(cause),
      }));

      if (outcome.kind === "refused") {
        onDiagnostic(`the navigation in ${id} was refused: ${outcome.reason}`);

        return outcome;
      }

      reloadOpen();

      return outcome;
    },
    [onDiagnostic, reloadOpen],
  );

  /**
   * Метка на записи. Своего состояния метка не заводит: рантайм пишет её записью в дерево, и
   * действующее значение — свёртка прочитанных записей. Поэтому после записи лента дочитывается.
   */
  const setEntryLabel = useCallback(
    async (entryId: string, label: string | null): Promise<string | undefined> => {
      const id = latest.current.open?.id;

      if (id === undefined) {
        return undefined;
      }

      const outcome = await setEntryLabelRequest(id, entryId, label).catch((cause: unknown) => ({
        kind: "refused" as const,
        reason: reasonOf(cause),
      }));

      if (outcome.kind === "refused") {
        onDiagnostic(`the entry ${entryId} could not be labelled: ${outcome.reason}`);

        return outcome.reason;
      }

      reloadOpen();

      return undefined;
    },
    [onDiagnostic, reloadOpen],
  );

  /** Запись, отдающая сессию. Список после неё перечитывается: изменилась не только открытая. */
  const written = useCallback(
    async (
      what: string,
      run: () => Promise<SessionOutcome | RemoveSessionOutcome>,
    ): Promise<string | undefined> => {
      const outcome = await run().catch((cause: unknown) => ({
        kind: "refused" as const,
        reason: reasonOf(cause),
      }));

      if (outcome.kind === "refused") {
        onDiagnostic(`${what}: ${outcome.reason}`);

        return outcome.reason;
      }

      reloadSessions();
      reloadOpen();

      return undefined;
    },
    [onDiagnostic, reloadOpen, reloadSessions],
  );

  const updateSession = useCallback(
    (id: string, update: SessionUpdate) =>
      written(`the session ${id} could not be written`, () => updateSessionRequest(id, update)),
    [written],
  );

  const removeSession = useCallback(
    (id: string) =>
      written(`the session ${id} could not be removed`, () => removeSessionRequest(id)),
    [written],
  );

  const forkSession = useCallback(
    async (request: SessionForkRequest): Promise<SessionOutcome> => {
      const id = latest.current.open?.id;

      if (id === undefined) {
        return { kind: "refused", reason: "no session is open" };
      }

      const outcome = await forkSessionRequest(id, request).catch((cause: unknown) => ({
        kind: "refused" as const,
        reason: reasonOf(cause),
      }));

      if (outcome.kind === "refused") {
        onDiagnostic(`the session ${id} could not be forked: ${outcome.reason}`);

        return outcome;
      }

      reloadSessions();

      return outcome;
    },
    [onDiagnostic, reloadSessions],
  );

  const setShowArchived = useCallback(
    (archived: boolean) => {
      apply((current) => showArchivedIn(current, archived));
      reloadSessions();
    },
    [apply, reloadSessions],
  );

  return {
    state,
    createSession,
    prepareDraft,
    loadModels,
    submitTurn,
    sendMessage,
    interrupt,
    compact,
    loadBranch,
    navigate,
    setEntryLabel,
    updateSession,
    removeSession,
    forkSession,
    setShowArchived,
    receiveSessionDelta,
  };
}
