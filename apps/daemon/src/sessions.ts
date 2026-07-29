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
  type SessionsSnapshot,
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
};

export type SessionService = {
  routes: () => Route[];
  /** Сколько сессий в папке проекта: считается по заголовкам файлов, без чтения записей. */
  countByFolderKey: (folderKey: string) => number;
  /** Перечитать список с диска. Зовётся при старте и после создания сессии. */
  refresh: () => Promise<void>;
  close: () => Promise<void>;
};

export function createSessionService(options: SessionServiceOptions): SessionService {
  const availabilityOf =
    options.availability ?? ((project: StoredProject) => probeProjectFolder(project.folder));

  /** Открытые сессии: harness поднят, подписка на дельты стоит. */
  const live = new Map<string, AgentSession>();

  let summaries: AgentSessionSummary[] = [];

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
    model: summary.model,
    thinkingLevel: summary.thinkingLevel,
    // Очередь знает про ожидание и работу, рантайм — про всё остальное. Спрашиваем сначала очередь:
    // сессия в очереди для рантайма ещё простаивает (docs/architecture.md).
    phase: phaseOf(summary.id),
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

  /** Открыть сессию, если она ещё не открыта. `undefined` — такой сессии нет или агент исчез. */
  const openSession = async (sessionId: string): Promise<AgentSession | undefined> => {
    const known = live.get(sessionId);

    if (known !== undefined) {
      return known;
    }

    const summary = summaries.find((candidate) => candidate.id === sessionId);

    if (summary === undefined) {
      return undefined;
    }

    const agent = agentsOf().find((candidate) => candidate.id === summary.agentId);

    if (agent === undefined) {
      return undefined;
    }

    const session = await options.store.open(sessionId, {
      id: agent.id,
      instructions: agent.instructions,
    });

    if (session === undefined) {
      return undefined;
    }

    watch(session);
    live.set(sessionId, session);

    return session;
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
  const places = new Map<string, { turnId: string; cancel: () => boolean }>();

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

  return {
    countByFolderKey: (folderKey) =>
      summaries.filter((summary) => summary.folderKey === folderKey).length,
    refresh,
    close: async () => {
      for (const session of live.values()) {
        await session.close();
      }

      live.clear();
    },
    routes: () => [
      {
        method: "GET",
        path: agentsPath,
        handle: ({ response }) => {
          // Ноль агентов — законный ответ: единственный плагин с агентом могли выключить.
          const snapshot: AgentsSnapshot = { agents: agentsOf().map(describeAgent) };

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
            sessions: summaries
              .filter((summary) => projectId === null || summary.projectId === projectId)
              .map(describeSession),
            // Битый файл сессии не отменяет остальные, в отличие от `projects.json`: сессия выпадает
            // из списка с названной причиной (docs/data-directory.md).
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

          const project = options.projects.find(parsed.value.projectId);

          if (project === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          if (project.archived) {
            respondWithError(response, 409, "the project is archived");

            return;
          }

          if (availabilityOf(project) === "missing") {
            respondWithError(response, 409, `the folder ${project.folder} is not there`);

            return;
          }

          const agent = agentsOf().find((candidate) => candidate.id === parsed.value.agentId);

          if (agent === undefined) {
            respondWithError(
              response,
              409,
              `no agent ${parsed.value.agentId} is enabled right now`,
            );

            return;
          }

          const model = parsed.value.model ?? agent.model;

          if (model === undefined) {
            respondWithError(
              response,
              409,
              `the agent ${agent.id} names no default model, so the model has to be named`,
            );

            return;
          }

          const created = await options.store.create({
            projectId: project.id,
            agentId: agent.id,
            folder: project.folder,
            folderKey: project.folderKey,
            model,
            thinkingLevel: parsed.value.thinkingLevel ?? agent.thinkingLevel ?? "off",
            agent: { id: agent.id, instructions: agent.instructions },
          });

          if ("kind" in created) {
            respondWithError(response, 409, `the model ${model} is not available right now`);

            return;
          }

          watch(created);
          live.set(created.summary().id, created);
          await refresh();
          announce();

          respondWithJson(response, 200, describeSession(created.summary()));
        },
      },
      {
        method: "GET",
        path: sessionPathPattern,
        handle: ({ response, parameters }) => {
          const summary = summaries.find((candidate) => candidate.id === parameters["sessionId"]);

          if (summary === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, describeSession(summary));
        },
      },
      {
        method: "GET",
        path: sessionEntriesPathPattern,
        handle: async ({ response, parameters, url }) => {
          const sessionId = parameters["sessionId"] ?? "";

          if (!isSessionId(sessionId)) {
            respondWithError(response, 404, "not found");

            return;
          }

          const session = await openSession(sessionId);

          if (session === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          const after = Number(url.searchParams.get(sessionEntriesAfterParameter) ?? "0");
          const page = await session.entries(Number.isSafeInteger(after) && after > 0 ? after : 0);

          respondWithJson(response, 200, { sessionId, ...page });
        },
      },
      {
        method: "POST",
        path: sessionTurnsPathPattern,
        handle: async ({ response, parameters, body }) => {
          const sessionId = parameters["sessionId"] ?? "";
          const parsed = parseTurnRequest(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          if (!isSessionId(sessionId)) {
            respondWithError(response, 404, "not found");

            return;
          }

          const session = await openSession(sessionId);

          if (session === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          if (phaseOf(sessionId) !== "idle") {
            respondWithError(response, 409, "the session is busy");

            return;
          }

          const summary = session.summary();
          const agent = agentsOf().find((candidate) => candidate.id === summary.agentId);

          if (agent === undefined) {
            respondWithError(response, 409, `no agent ${summary.agentId} is enabled right now`);

            return;
          }

          if (parsed.value.model !== undefined) {
            const applied = await session.setModel(parsed.value.model);

            if (applied.kind === "unknown-model") {
              respondWithError(
                response,
                409,
                `the model ${parsed.value.model} is not available right now`,
              );

              return;
            }
          }

          if (parsed.value.thinkingLevel !== undefined) {
            await session.setThinkingLevel(parsed.value.thinkingLevel);
          }

          const place = options.queue.submit({
            sessionId,
            kind: "turn",
            run: async (turnId) => {
              try {
                // Набор пересобирается перед каждым турном, а не берётся снимком на старте сессии:
                // инструменты исчезают вместе с выключенным плагином (docs/sessions-and-projects.md).
                await applyTools(session, agent, summary.folder);

                const outcome = await session.prompt(parsed.value.text, turnId);

                if (outcome.kind === "failed") {
                  options.logger.warn("a turn failed", {
                    session: sessionId,
                    reason: outcome.reason,
                  });
                }
              } finally {
                places.delete(sessionId);
              }
            },
          });

          places.set(sessionId, place);

          // Ожидание в очереди — наблюдаемое состояние, и узнать о нём надо не только из ответа:
          // за сессией смотрят и другие вкладки (docs/architecture.md).
          if (place.state === "queued") {
            options.emitDelta({
              sessionId,
              turnId: place.turnId,
              delta: { kind: "phase", phase: "queued" },
            });
          }

          announce();

          respondWithJson(response, 200, {
            sessionId,
            turnId: place.turnId,
            phase: phaseOf(sessionId),
          });
        },
      },
      {
        method: "DELETE",
        path: sessionTurnsPathPattern,
        handle: async ({ response, parameters }) => {
          const sessionId = parameters["sessionId"] ?? "";

          if (!isSessionId(sessionId) || !summaries.some((one) => one.id === sessionId)) {
            respondWithError(response, 404, "not found");

            return;
          }

          // Ещё не начатый турн снимается очередью, идущий — рантаймом. Порядок именно такой:
          // снятый с очереди не должен успеть стартовать между двумя проверками.
          const place = places.get(sessionId);
          const dropped = place?.cancel() ?? false;

          if (dropped) {
            places.delete(sessionId);
          }

          const session = live.get(sessionId);
          const interrupted = dropped || (session === undefined ? false : await session.abort());

          if (interrupted) {
            announce();
          }

          respondWithJson(response, 200, { sessionId, interrupted });
        },
      },
    ],
  };
}
