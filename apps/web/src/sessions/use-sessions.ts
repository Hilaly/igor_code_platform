/**
 * Связь вью сессий с демоном: список и агенты на подъёме соединения, записи открытой сессии по её
 * адресу, турн и прерывание по нажатию. Своего потока вью не открывает — соединение одно на вкладку
 * (docs/web-api.md).
 *
 * Дельты турна приезжают не шиной, а отдельным кадром того же соединения: их сотни на один ответ
 * модели, и на шину они не выходят (docs/sessions-and-projects.md). Поэтому кадр приходит сюда
 * вызовом `receiveSessionDelta`, как шаг входа во вью провайдеров.
 */

import type { SessionDeltaFrame, SessionDraft } from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { fetchProjectsSnapshot } from "../projects/api.ts";
import { fetchProviderModels, fetchProvidersSnapshot } from "../providers/api.ts";
import {
  createSession as createSessionRequest,
  fetchAgents,
  fetchEntries,
  fetchSession,
  fetchSessions,
  interruptTurn,
  submitTurn as submitTurnRequest,
  type CreateSessionOutcome,
} from "./api.ts";
import {
  applyAgents,
  applyEntries,
  applyFailure,
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
  interrupt: () => void;
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

    void fetchSessions(undefined, controller.signal)
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
   * Снимок открытой сессии и её записи. Спрашиваются вместе и одним отменяемым запросом на двоих:
   * порознь они разошлись бы — фаза из одного ответа, записи из другого.
   *
   * Курсор берётся из состояния: после переподъёма он обнулён, и история читается заново.
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
    ])
      .then(([summary, page]) => {
        apply((current) => applySummary(current, id, summary));

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

          // Текст показывается сразу: турн, вставший в очередь, не даёт ни одной дельты.
          apply((current) => applyPendingTurn(current, id, outcome.accepted.turnId, text));
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

  return {
    state,
    createSession,
    prepareDraft,
    loadModels,
    submitTurn,
    interrupt,
    receiveSessionDelta,
  };
}
