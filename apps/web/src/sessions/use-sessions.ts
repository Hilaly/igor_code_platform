/**
 * Связь вью сессий с демоном: список на подъёме соединения, проектный каталог агентов по выбору в
 * черновике, записи открытой сессии по её адресу, турн и прерывание по нажатию. Своего потока вью
 * не открывает — соединение одно на вкладку (docs/web-api.md).
 *
 * Дельты турна приезжают не шиной, а отдельным кадром того же соединения: их сотни на один ответ
 * модели, и на шину они не выходят (docs/sessions-and-projects.md). Поэтому кадр приходит сюда
 * вызовом `receiveSessionDelta`, как шаг входа во вью провайдеров.
 */

import {
  coreEventTypes,
  type AgentSummary,
  type SessionDeltaFrame,
  type SessionDraft,
  type SessionForkRequest,
  type SessionMessage,
  type SessionNavigateRequest,
  type SessionUpdate,
  type TurnRequest,
} from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { fetchProjectsSnapshot } from "../projects/api.ts";
import { fetchProviderModels, fetchProvidersSnapshot } from "../providers/api.ts";
import {
  createSession as createSessionRequest,
  fetchBranch,
  fetchContextUsage,
  fetchSessionCommands,
  fetchEntries,
  fetchSession,
  fetchSessions,
  fetchProjectAgents,
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
  applyBranch,
  applyCommands,
  applyContext,
  applyEntries,
  applyFailure,
  applyStats,
  applyModels,
  applyModelsFailure,
  applyOpenFailure,
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
  resetBranch,
  showArchived as showArchivedIn,
  startModels,
  type SessionsState,
} from "./state.ts";
import { skillInvocation, templateInvocation } from "./slash-command.ts";

export type UseSessionsOptions = {
  bus: Pick<FrontendBus, "subscribe">;
  stream: StreamStatus;
  /** Открытая сессия приходит из адреса: маршрут — источник истины, а не состояние вью. */
  sessionId?: string;
  /** На странице проекта список ограничен его идентификатором; адрес открытой сессии остаётся отдельным. */
  projectId?: string;
  /** Фиксированный набор для постоянной панели или отдельного архива. */
  archived?: boolean;
  onDiagnostic: (diagnostic: string) => void;
};

export type SessionsController = {
  state: SessionsState;
  projectAgents: ProjectAgentsState;
  createSession: (draft: SessionDraft) => Promise<CreateSessionOutcome>;
  /** Подготовить диалог создания: проекты и настроенные провайдеры. Зовётся по его открытию. */
  prepareDraft: () => void;
  /** Подготовить настроенные провайдеры для выбора модели следующего турна. */
  prepareModels: () => void;
  /** Выбрать проект черновика и прочитать только разрешённых в нём агентов. */
  selectProject: (projectId: string) => void;
  /** Модели одного провайдера. Все сразу не спрашиваем: их больше тысячи (docs/web-api.md). */
  loadModels: (providerId: string) => void;
  submitTurn: SubmitTurn;
  /** Первый турн новой сессии адресуется явно: переход по маршруту применяется React асинхронно. */
  submitTurnToSession: SubmitTurnToSession;
  /** Сообщение, которое не запускает турн. Отказ приезжает причиной, а не исключением. */
  sendMessage: (message: SessionMessage) => Promise<string | undefined>;
  interrupt: () => void;
  /** Свернуть контекст руками. Инструкции пересказа необязательны. Возвращает причину отказа. */
  compact: (instructions?: string) => Promise<string | undefined>;
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

export type SubmitTurn = (request: TurnRequest) => Promise<string | undefined>;
export type SubmitTurnToSession = (
  sessionId: string,
  request: TurnRequest,
) => Promise<string | undefined>;
export type PrepareModels = () => void;

export type ProjectAgentsState = {
  projectId?: string;
  agents?: AgentSummary[];
  loading: boolean;
  failure?: string;
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Что показать в ленте, пока турн ждёт очереди. У турна скилом реплики нет — вместо неё видно то,
 * что человек набрал в композере: ту же строку запуска, которую подставил каталог.
 */
const said = (request: TurnRequest): string => {
  if (request.skill !== undefined) {
    return skillInvocation(request.skill, request.instructions);
  }

  return request.template === undefined
    ? request.text
    : templateInvocation(request.template, request.arguments);
};

export function useSessions(options: UseSessionsOptions): SessionsController {
  const { bus, stream, sessionId, projectId, archived, onDiagnostic } = options;
  const [state, setState] = useState<SessionsState>(initialSessionsState);
  const [projectAgents, setProjectAgents] = useState<ProjectAgentsState>({ loading: false });

  // То же зеркало, что во вью провайдеров: правило смотрит на предыдущее состояние, а дельты
  // приходят чаще, чем React успевает отрисовать. Единственный источник изменения — `apply`.
  const latest = useRef<SessionsState>(initialSessionsState);
  const apply = useCallback((next: (current: SessionsState) => SessionsState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  const pendingSessions = useRef<AbortController | undefined>(undefined);
  const pendingDraftProjects = useRef<AbortController | undefined>(undefined);
  const draftProjectsSequence = useRef(0);
  const pendingAgents = useRef<AbortController | undefined>(undefined);
  const projectAgentsSequence = useRef(0);
  const selectedProject = useRef<string | undefined>(undefined);
  const pendingOpen = useRef<AbortController | undefined>(undefined);

  const reloadSessions = useCallback(() => {
    pendingSessions.current?.abort();

    const controller = new AbortController();
    pendingSessions.current = controller;

    void fetchSessions(
      projectId,
      archived === undefined ? latest.current.showArchived : archived,
      controller.signal,
    )
      .then((snapshot) => apply((current) => applySessions(current, snapshot)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the sessions could not be read: ${reason}`);
        apply((current) => applyFailure(current, reason));
      });
  }, [apply, archived, onDiagnostic, projectId]);

  const reloadProjectAgents = useCallback(
    (selected: string) => {
      pendingAgents.current?.abort();

      const controller = new AbortController();
      pendingAgents.current = controller;
      const sequence = projectAgentsSequence.current + 1;
      projectAgentsSequence.current = sequence;
      setProjectAgents({ projectId: selected, loading: true });

      void fetchProjectAgents(selected, controller.signal)
        .then((snapshot) => {
          if (controller.signal.aborted || projectAgentsSequence.current !== sequence) {
            return;
          }

          setProjectAgents({ projectId: selected, agents: snapshot.agents, loading: false });
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || projectAgentsSequence.current !== sequence) {
            return;
          }

          const failure = reasonOf(cause);
          onDiagnostic(`the agents of project ${selected} could not be read: ${failure}`);
          setProjectAgents({ projectId: selected, loading: false, failure });
        });
    },
    [onDiagnostic],
  );

  const selectProject = useCallback(
    (selected: string) => {
      selectedProject.current = selected === "" ? undefined : selected;

      if (selected === "") {
        pendingAgents.current?.abort();
        projectAgentsSequence.current += 1;
        setProjectAgents({ loading: false });
        return;
      }

      reloadProjectAgents(selected);
    },
    [reloadProjectAgents],
  );

  const reloadDraftProjects = useCallback(() => {
    pendingDraftProjects.current?.abort();

    const controller = new AbortController();
    pendingDraftProjects.current = controller;
    const sequence = draftProjectsSequence.current + 1;
    draftProjectsSequence.current = sequence;

    void fetchProjectsSnapshot(controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted || draftProjectsSequence.current !== sequence) {
          return;
        }

        apply((current) => applyProjects(current, snapshot.projects));

        const selected = selectedProject.current;
        if (
          selected !== undefined &&
          !latest.current.projects?.some((project) => project.id === selected)
        ) {
          selectProject("");
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || draftProjectsSequence.current !== sequence) {
          return;
        }

        onDiagnostic(`the projects could not be read: ${reasonOf(cause)}`);
      });
  }, [apply, onDiagnostic, selectProject]);

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
      pendingOpen.current?.abort();
      pendingOpen.current = undefined;

      return;
    }

    pendingOpen.current?.abort();

    const controller = new AbortController();
    pendingOpen.current = controller;
    const { id, seen } = open;
    apply((current) => resetBranch(current, id));

    void Promise.all([
      fetchSession(id, controller.signal),
      fetchEntries(id, seen, controller.signal),
      fetchStats(id, controller.signal),
      fetchContextUsage(id, controller.signal),
      fetchSessionCommands(id, controller.signal),
    ])
      .then(([summary, page, stats, context, commands]) => {
        if (controller.signal.aborted) {
          return;
        }

        apply((current) => applySummary(current, id, summary));
        apply((current) => applyStats(current, id, stats));
        apply((current) => applyContext(current, id, context));
        apply((current) => applyCommands(current, id, commands));

        if (page !== undefined) {
          apply((current) => applyEntries(current, id, page.entries, page.seen));
        }

        void fetchBranch(id, undefined, controller.signal)
          .then((branch) => {
            if (controller.signal.aborted) {
              return;
            }

            apply((current) => applyBranch(current, id, branch));
          })
          .catch((cause: unknown) => {
            if (controller.signal.aborted) {
              return;
            }

            onDiagnostic(`the branch of ${id} could not be read: ${reasonOf(cause)}`);
          });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the session ${id} could not be read: ${reason}`);
        apply((current) => applyOpenFailure(current, id, reason));
      });
  }, [apply, onDiagnostic]);

  // Порядок эффектов важен: сначала состояние узнаёт про адрес, потом по нему идут запросы.
  useEffect(() => {
    return () => {
      pendingOpen.current?.abort();
      pendingOpen.current = undefined;
    };
  }, [sessionId, stream]);

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
    if (selectedProject.current !== undefined) {
      reloadProjectAgents(selectedProject.current);
    }
    reloadOpen();
  }, [apply, reloadOpen, reloadProjectAgents, reloadSessions, sessionId, stream]);

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      const outcome = applyStreamEvent(latest.current, event);

      apply(() => outcome.state);

      if (outcome.sessions) {
        reloadSessions();
        reloadOpen();
      }

      if (event.type === coreEventTypes.contributionsChanged) {
        reloadOpen();
      }

      if (
        event.type === coreEventTypes.contributionsChanged &&
        selectedProject.current !== undefined
      ) {
        reloadProjectAgents(selectedProject.current);
      }

      if (event.type === coreEventTypes.projectsChanged && latest.current.projects !== undefined) {
        reloadDraftProjects();
      }
    });

    return unsubscribe;
  }, [apply, bus, reloadDraftProjects, reloadOpen, reloadProjectAgents, reloadSessions]);

  useEffect(
    () => () => {
      pendingSessions.current?.abort();
      pendingDraftProjects.current?.abort();
      pendingAgents.current?.abort();
      pendingOpen.current?.abort();
    },
    [],
  );

  const prepareModels = useCallback<PrepareModels>(() => {
    void fetchProvidersSnapshot()
      .then((snapshot) => apply((current) => applyProviders(current, snapshot.providers)))
      .catch((cause: unknown) =>
        onDiagnostic(`the providers could not be read: ${reasonOf(cause)}`),
      );
  }, [apply, onDiagnostic]);

  const prepareDraft = useCallback(() => {
    reloadDraftProjects();
    prepareModels();
  }, [prepareModels, reloadDraftProjects]);

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

  const submitTurnToSession = useCallback<SubmitTurnToSession>(
    async (id, request) => {
      // Маршрут применится отдельным React-рендером, а ответ POST может прийти раньше. Открываем
      // адресный state синхронно, чтобы queued/refused outcome не потерялся на прежней сессии.
      apply((current) => openSession(current, id));

      let outcome;
      try {
        outcome = await submitTurnRequest(id, request);
      } catch (cause: unknown) {
        const reason = reasonOf(cause);

        onDiagnostic(`the turn could not be submitted: ${reason}`);
        apply((current) => applyTurnFailure(current, id, reason));

        return reason;
      }

      if (outcome.kind === "refused") {
        onDiagnostic(`the turn was refused: ${outcome.reason}`);
        apply((current) => applyTurnFailure(current, id, outcome.reason));

        return outcome.reason;
      }

      // Текст показывается сразу — но только у турна, вставшего в очередь: он не даёт ни одной
      // дельты, и без этого реплика ждала бы конца чужого турна. У начатого турна запись уже
      // пишется, и вторая копия реплики висела бы в ленте до самого конца работы.
      if (outcome.accepted.phase === "queued") {
        apply((current) => applyPendingTurn(current, id, outcome.accepted.turnId, said(request)));
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

      return undefined;
    },
    [apply, onDiagnostic],
  );

  const submitTurn = useCallback<SubmitTurn>(
    async (request) => {
      const id = latest.current.open?.id;

      if (id !== undefined) {
        return submitTurnToSession(id, request);
      }

      return undefined;
    },
    [submitTurnToSession],
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
    projectAgents,
    createSession,
    prepareDraft,
    prepareModels,
    selectProject,
    loadModels,
    submitTurn,
    submitTurnToSession,
    sendMessage,
    interrupt,
    compact,
    navigate,
    setEntryLabel,
    updateSession,
    removeSession,
    forkSession,
    setShowArchived,
    receiveSessionDelta,
  };
}
