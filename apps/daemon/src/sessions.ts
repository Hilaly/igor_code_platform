/**
 * Сессии агента через веб-API (docs/sessions-and-projects.md).
 *
 * Сессия живёт в ядре, а не в плагине, который её создал: выгрузка плагина её не останавливает
 * (docs/architecture.md). Здесь же сходятся три вещи, до этого жившие порознь: сборка набора
 * инструментов, очередь походов к модели и поток дельт.
 */

import {
  agentsPath,
  coreEventTypes,
  isSessionId,
  parseSessionDraft,
  parseTurnRequest,
  selectToolNames,
  sessionEntriesAfterParameter,
  sessionEntriesPathPattern,
  sessionPathPattern,
  sessionProjectParameter,
  sessionsPath,
  sessionTurnsPathPattern,
  type AgentContributionRegistration,
  type AgentsSnapshot,
  type AgentSummary,
  type ContributionRegistration,
  type Session,
  type SessionDraft,
  type SessionEntriesPage,
  type SessionsSnapshot,
  type TurnAccepted,
  type TurnRequest,
} from "@sovereign/protocol";
import type {
  AgentSession,
  AgentSessionStore,
  AgentSessionSummary,
} from "@sovereign/agent-runtime-pi";

import { respondWithError, respondWithJson, type Route } from "./dispatcher.ts";
import type { EventBus } from "./event-bus.ts";
import type { Logger } from "./logger.ts";
import { probeProjectFolder } from "./project-availability.ts";
import type { ProjectStore, StoredProject } from "./project-store.ts";
import type { ProjectLifecycle } from "./project-lifecycle.ts";
import type { ToolCollector } from "./tool-collection.ts";
import type { TurnQueue } from "./turn-queue.ts";

export type SessionDeltaSink = (frame: {
  sessionId: string;
  turnId: string;
  delta: Parameters<Parameters<AgentSession["subscribe"]>[0]>[0];
}) => void;

export type SessionServiceOptions = {
  store: AgentSessionStore;
  projects: Pick<ProjectStore, "find" | "list">;
  /** Действующий набор вкладов. Агенты выбираются из него, а не из отдельного списка. */
  contributions: () => ContributionRegistration[];
  tools: ToolCollector;
  queue: TurnQueue;
  bus: Pick<EventBus, "publish">;
  emitDelta: SessionDeltaSink;
  logger: Logger;
  availability?: (project: StoredProject) => "available" | "missing";
  projectLifecycle?: ProjectLifecycle;
};

/** Исход создания. Отказ домена — не исключение: маршрут переводит его в код, мост — в текст. */
export type CreateSessionOutcome =
  | { kind: "created"; session: Session }
  | { kind: "unknown-project" }
  | { kind: "refused"; reason: string };

export type PromptRequest = TurnRequest & { sessionId: string };

export type PromptOutcome =
  | { kind: "accepted"; turn: TurnAccepted }
  | { kind: "unknown" }
  | { kind: "refused"; reason: string };

export type SessionService = {
  /** Включённые агенты. Пустой список — законный ответ. */
  agents: () => AgentSummary[];
  list: (projectId?: string) => Session[];
  create: (draft: SessionDraft) => Promise<CreateSessionOutcome>;
  /** `undefined` — такой сессии нет. */
  entries: (sessionId: string, after?: number) => Promise<SessionEntriesPage | undefined>;
  prompt: (request: PromptRequest) => Promise<PromptOutcome>;
  /** `false` — прерывать было нечего. */
  abort: (sessionId: string) => Promise<boolean>;
  routes: () => Route[];
  /** Сколько сессий в папке проекта: считается по снимку списка, без похода на диск. */
  countByFolderKey: (folderKey: string) => number;
  /** Перечитать список с диска. Зовётся при старте и после создания сессии. */
  refresh: () => Promise<void>;
  close: () => Promise<void>;
};

export function createSessionService(options: SessionServiceOptions): SessionService {
  const availabilityOf =
    options.availability ?? ((project: StoredProject) => probeProjectFolder(project.folder));
  const projectLifecycle: ProjectLifecycle = options.projectLifecycle ?? {
    run: async (_projectId, operation) => operation(),
  };

  /** Открытые сессии: harness поднят, подписка на дельты стоит. */
  const live = new Map<string, AgentSession>();
  /** Один подъём harness на сессию: параллельные первые обращения ждут один и тот же результат. */
  const opening = new Map<string, Promise<OpenSessionOutcome>>();

  let summaries: AgentSessionSummary[] = [];
  let closing = false;

  const announce = (): void => {
    options.bus.publish(coreEventTypes.sessionsChanged, {});
  };

  const refresh = async (): Promise<void> => {
    summaries = await options.store.list();
  };

  const agentsOf = (): AgentContributionRegistration[] =>
    options
      .contributions()
      .filter(
        (registration): registration is AgentContributionRegistration =>
          registration.kind === "agent",
      );

  const describeAgent = (agent: AgentContributionRegistration): AgentSummary => ({
    id: agent.id,
    ...(agent.title === undefined ? {} : { title: agent.title }),
    ...(agent.description === undefined ? {} : { description: agent.description }),
    pluginKey: agent.pluginKey,
    source: agent.source,
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
    skills: [...agent.skills],
  });

  const describeSession = (summary: AgentSessionSummary): Session => ({
    id: summary.id,
    projectId: summary.projectId,
    folder: summary.folder,
    agentId: summary.agentId,
    // Модель и уровень ризонинга меняются в открытом harness и пишутся в JSONL. Снимок списка
    // намеренно не обновляем на каждый турн, поэтому для живой сессии берём именно её summary.
    model: live.get(summary.id)?.summary().model ?? summary.model,
    thinkingLevel: live.get(summary.id)?.summary().thinkingLevel ?? summary.thinkingLevel,
    // Очередь знает про ожидание и работу, рантайм — про всё остальное. Спрашиваем сначала очередь:
    // сессия в очереди для рантайма ещё простаивает (docs/architecture.md).
    phase: phaseOf(summary.id),
    ...(summary.name === undefined ? {} : { title: summary.name }),
    archived: summary.archived,
    createdAt: summary.createdAt,
  });

  /**
   * Очередь — источник истины про занятость, рантайм — про то, чем именно сессия занята. Порядок
   * именно такой: сессия, стоящая в очереди, для рантайма ещё простаивает, а сессия, чья работа уже
   * снята с очереди, ещё не успела дойти до `prompt` — и «простаивает» было бы про неё враньём
   * (docs/architecture.md).
   */
  const phaseOf = (sessionId: string): Session["phase"] => {
    const state = options.queue.stateOf(sessionId);

    if (state === "queued") {
      return "queued";
    }

    const runtime = live.get(sessionId)?.phase() ?? "idle";

    return state === "running" && runtime === "idle" ? "turn" : runtime;
  };

  type OpenSessionOutcome =
    | { kind: "opened"; session: AgentSession }
    | { kind: "unknown" }
    | { kind: "unavailable"; reason: string };

  /** Поднять harness с текущими агентом и моделью. Одна попытка на параллельные обращения. */
  const openSession = async (sessionId: string): Promise<OpenSessionOutcome> => {
    if (closing) {
      return { kind: "unknown" };
    }

    const known = live.get(sessionId);

    if (known !== undefined) {
      return { kind: "opened", session: known };
    }

    const pending = opening.get(sessionId);

    if (pending !== undefined) {
      return pending;
    }

    const open = (async () => {
      const summary = summaries.find((candidate) => candidate.id === sessionId);

      if (summary === undefined) {
        return { kind: "unknown" } as const;
      }

      const agent = agentsOf().find((candidate) => candidate.id === summary.agentId);

      if (agent === undefined) {
        return {
          kind: "unavailable",
          reason: `no agent ${summary.agentId} is enabled right now`,
        } as const;
      }

      const persisted = await options.store.open(sessionId);

      if (persisted === undefined) {
        return { kind: "unknown" } as const;
      }

      const activated = persisted.activate({
        id: agent.id,
        instructions: agent.instructions,
      });

      if ("kind" in activated) {
        return {
          kind: "unavailable",
          reason: `the model ${persisted.summary().model} is not available right now`,
        } as const;
      }

      watch(activated);
      live.set(sessionId, activated);

      return { kind: "opened", session: activated } as const;
    })();

    opening.set(sessionId, open);

    try {
      return await open;
    } finally {
      if (opening.get(sessionId) === open) {
        opening.delete(sessionId);
      }
    }
  };

  /**
   * Подписка на дельты живёт столько же, сколько открытая сессия. Идентификатор турна берётся из
   * очереди: дельта без него не склеивается с ответом на запуск.
   */
  const watch = (session: AgentSession): void => {
    const sessionId = session.summary().id;

    session.subscribe((delta) => {
      options.emitDelta({ sessionId, turnId: places.get(sessionId)?.turnId ?? "", delta });

      if (delta.kind === "phase") {
        announce();
      }
    });
  };

  /**
   * Место в очереди у турна, который сейчас числится за сессией. Живёт от постановки до возврата в
   * простой: по нему прерывается ещё не начатый турн, и из него берётся идентификатор для дельт.
   */
  const places = new Map<string, { turnId: string; cancel: () => boolean; validating: boolean }>();

  /** Набор инструментов пересобирается перед каждым турном: сессия доигрывает с тем, что осталось. */
  const applyTools = async (
    session: AgentSession,
    agent: AgentContributionRegistration,
    folder: string,
  ): Promise<void> => {
    const collected = await options.tools.collect({ folder });

    for (const problem of collected.problems) {
      options.logger.warn("a tool source did not answer", { problem });
    }

    const names = collected.tools.map((tool) => tool.name);

    await session.setTools(
      collected.tools.map((tool) => ({ name: tool.name, tool: tool.tool })),
      selectToolNames(names, agent.tools),
    );
  };

  /** Операции. Маршруты и мост плагинов зовут их одни и те же: набор обязан быть один. */
  const agents = (): AgentSummary[] => agentsOf().map(describeAgent);

  const visible = (summary: AgentSessionSummary): boolean => {
    const project = options.projects.find(summary.projectId);

    return project !== undefined && !project.archived;
  };

  const list = (projectId?: string): Session[] =>
    summaries
      .filter((summary) => projectId === undefined || summary.projectId === projectId)
      .filter(visible)
      .map(describeSession);

  const create = (draft: SessionDraft): Promise<CreateSessionOutcome> =>
    projectLifecycle.run(draft.projectId, async () => {
      const project = options.projects.find(draft.projectId);

      if (project === undefined) {
        return { kind: "unknown-project" };
      }

      if (project.archived) {
        return { kind: "refused", reason: "the project is archived" };
      }

      if (availabilityOf(project) === "missing") {
        return { kind: "refused", reason: `the folder ${project.folder} is not there` };
      }

      const agent = agentsOf().find((candidate) => candidate.id === draft.agentId);

      if (agent === undefined) {
        return { kind: "refused", reason: `no agent ${draft.agentId} is enabled right now` };
      }

      const model = draft.model ?? agent.model;

      if (model === undefined) {
        return {
          kind: "refused",
          reason: `the agent ${agent.id} names no default model, so the model has to be named`,
        };
      }

      const created = await options.store.create({
        projectId: project.id,
        agentId: agent.id,
        folder: project.folder,
        folderKey: project.folderKey,
        model,
        thinkingLevel: draft.thinkingLevel ?? agent.thinkingLevel ?? "off",
        agent: { id: agent.id, instructions: agent.instructions },
      });

      if ("kind" in created) {
        return { kind: "refused", reason: `the model ${model} is not available right now` };
      }

      watch(created);
      live.set(created.summary().id, created);
      await refresh();
      announce();

      return { kind: "created", session: describeSession(created.summary()) };
    });

  const entries = async (
    sessionId: string,
    after?: number,
  ): Promise<SessionEntriesPage | undefined> => {
    if (!isSessionId(sessionId)) {
      return undefined;
    }

    const summary = summaries.find((candidate) => candidate.id === sessionId);

    if (summary === undefined || !visible(summary)) {
      return undefined;
    }

    const persisted = await options.store.open(sessionId);

    if (persisted === undefined) {
      return undefined;
    }

    const from = after !== undefined && Number.isSafeInteger(after) && after > 0 ? after : 0;

    return { sessionId, ...(await persisted.entries(from)) };
  };

  const prompt = async (request: PromptRequest): Promise<PromptOutcome> => {
    const sessionId = request.sessionId;

    if (!isSessionId(sessionId)) {
      return { kind: "unknown" };
    }

    const persistedSummary = summaries.find((candidate) => candidate.id === sessionId);

    if (persistedSummary === undefined || !visible(persistedSummary)) {
      return { kind: "unknown" };
    }

    const opened = await openSession(sessionId);

    if (opened.kind === "unknown") {
      return { kind: "unknown" };
    }

    if (opened.kind === "unavailable") {
      return { kind: "refused", reason: opened.reason };
    }

    const session = opened.session;
    if (phaseOf(sessionId) !== "idle") {
      return { kind: "refused", reason: "the session is busy" };
    }

    const summary = session.summary();
    const agent = agentsOf().find((candidate) => candidate.id === summary.agentId);

    if (agent === undefined) {
      return { kind: "refused", reason: `no agent ${summary.agentId} is enabled right now` };
    }

    const project = options.projects.find(summary.projectId);

    if (project === undefined || project.archived) {
      return {
        kind: "refused",
        reason: project?.archived === true ? "the project is archived" : "the project is gone",
      };
    }

    const place = options.queue.reserve(sessionId);

    if (place.kind === "busy") {
      return { kind: "refused", reason: "the session is busy" };
    }

    const tracked = { turnId: place.turnId, cancel: place.cancel, validating: true };

    places.set(sessionId, tracked);

    try {
      if (session.validateModel().kind === "unknown-model") {
        place.release();
        places.delete(sessionId);
        return {
          kind: "refused",
          reason: `the model ${summary.model} is not available right now`,
        };
      }

      if (request.model !== undefined) {
        const applied = await session.setModel(request.model);

        if (applied.kind === "unknown-model") {
          place.release();
          places.delete(sessionId);
          return {
            kind: "refused",
            reason: `the model ${request.model} is not available right now`,
          };
        }
      }

      if (place.cancelled()) {
        place.release();
        places.delete(sessionId);
        return { kind: "refused", reason: "the turn was cancelled" };
      }

      if (request.thinkingLevel !== undefined) {
        await session.setThinkingLevel(request.thinkingLevel);
      }
    } catch (cause) {
      place.release();
      places.delete(sessionId);

      throw cause;
    }

    const started = place.start({
      kind: "turn",
      run: async (turnId) => {
        try {
          // Набор пересобирается перед каждым турном, а не берётся снимком на старте сессии:
          // инструменты исчезают вместе с выключенным плагином (docs/sessions-and-projects.md).
          await applyTools(session, agent, summary.folder);

          const outcome = await session.prompt(request.text, turnId);

          if (outcome.kind === "failed") {
            options.logger.warn("a turn failed", { session: sessionId, reason: outcome.reason });
          }
        } finally {
          places.delete(sessionId);
        }
      },
    });

    if (started === undefined) {
      places.delete(sessionId);
      return { kind: "refused", reason: "the turn was cancelled" };
    }

    tracked.validating = false;

    // Ожидание в очереди — наблюдаемое состояние, и узнать о нём надо не только из ответа: за
    // сессией смотрят и другие вкладки (docs/architecture.md).
    if (started.state === "queued") {
      options.emitDelta({
        sessionId,
        turnId: started.turnId,
        delta: { kind: "phase", phase: "queued" },
      });
    }

    announce();

    return {
      kind: "accepted",
      turn: { sessionId, turnId: started.turnId, phase: phaseOf(sessionId) },
    };
  };

  const abort = async (sessionId: string): Promise<boolean> => {
    if (!isSessionId(sessionId) || !summaries.some((one) => one.id === sessionId)) {
      return false;
    }

    // Ещё не начатый турн снимается очередью, идущий — рантаймом. Порядок именно такой: снятый с
    // очереди не должен успеть стартовать между двумя проверками.
    const place = places.get(sessionId);
    const dropped = place?.cancel() ?? false;

    if (dropped && place?.validating !== true) {
      places.delete(sessionId);
    }

    const session = live.get(sessionId);
    const interrupted = dropped || (session === undefined ? false : await session.abort());

    if (interrupted) {
      announce();
    }

    return interrupted;
  };

  return {
    agents,
    list,
    create,
    entries,
    prompt,
    abort,
    countByFolderKey: (folderKey) =>
      summaries.filter((summary) => summary.folderKey === folderKey).length,
    refresh,
    close: async () => {
      closing = true;
      await Promise.allSettled(opening.values());

      for (const sessionId of live.keys()) {
        // Через стор, а не через саму сессию: владельца файла держит он, и забыть её должен он же.
        await options.store.close(sessionId);
      }

      opening.clear();
      live.clear();
    },
    routes: () => [
      {
        method: "GET",
        path: agentsPath,
        handle: ({ response }) => {
          // Ноль агентов — законный ответ: единственный плагин с агентом могли выключить.
          const snapshot: AgentsSnapshot = { agents: agents() };

          respondWithJson(response, 200, snapshot);
        },
      },
      {
        method: "GET",
        path: sessionsPath,
        handle: ({ response, url }) => {
          const projectId = url.searchParams.get(sessionProjectParameter);
          const problems = options.store.problems();
          const snapshot: SessionsSnapshot = {
            sessions: list(projectId ?? undefined),
            // Битый файл сессии не отменяет остальные, в отличие от `projects.json`: сессия
            // выпадает из списка с названной причиной (docs/data-directory.md).
            ...(problems.length === 0 ? {} : { problems }),
          };

          respondWithJson(response, 200, snapshot);
        },
      },
      {
        method: "POST",
        path: sessionsPath,
        handle: async ({ response, body }) => {
          const parsed = parseSessionDraft(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const created = await create(parsed.value);

          if (created.kind === "unknown-project") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (created.kind === "refused") {
            respondWithError(response, 409, created.reason);

            return;
          }

          respondWithJson(response, 200, created.session);
        },
      },
      {
        method: "GET",
        path: sessionPathPattern,
        handle: ({ response, parameters }) => {
          const found = list().find((session) => session.id === parameters["sessionId"]);

          if (found === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, found);
        },
      },
      {
        method: "GET",
        path: sessionEntriesPathPattern,
        handle: async ({ response, parameters, url }) => {
          const page = await entries(
            parameters["sessionId"] ?? "",
            Number(url.searchParams.get(sessionEntriesAfterParameter) ?? "0"),
          );

          if (page === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, page);
        },
      },
      {
        method: "POST",
        path: sessionTurnsPathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseTurnRequest(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const started = await prompt({
            sessionId: parameters["sessionId"] ?? "",
            ...parsed.value,
          });

          if (started.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (started.kind === "refused") {
            respondWithError(response, 409, started.reason);

            return;
          }

          respondWithJson(response, 200, started.turn);
        },
      },
      {
        method: "DELETE",
        path: sessionTurnsPathPattern,
        handle: async ({ response, parameters }) => {
          const sessionId = parameters["sessionId"] ?? "";

          if (!list().some((session) => session.id === sessionId)) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, {
            sessionId,
            interrupted: await abort(sessionId),
          });
        },
      },
    ],
  };
}
