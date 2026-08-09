/**
 * Сессии агента через веб-API (docs/sessions-and-projects.md).
 *
 * Сессия живёт в ядре, а не в плагине, который её создал: выгрузка плагина её не останавливает
 * (docs/architecture.md). Здесь же сходятся три вещи, до этого жившие порознь: сборка набора
 * инструментов, очередь походов к модели и поток дельт.
 */

import { dirname } from "node:path";

import {
  agentsPath,
  coreEventTypes,
  isSessionId,
  parseSessionCompactRequest,
  parseSessionDraft,
  parseSessionForkRequest,
  parseSessionLabelUpdate,
  parseSessionMessage,
  parseSessionNavigateRequest,
  parseSessionUpdate,
  parseTurnRequest,
  selectNames,
  sessionArchivedParameter,
  sessionBranchFromParameter,
  sessionBranchPathPattern,
  sessionCompactPathPattern,
  sessionContextPathPattern,
  sessionEntriesAfterParameter,
  sessionEntriesPathPattern,
  sessionEntryLabelPathPattern,
  sessionForkPathPattern,
  sessionMessagesPathPattern,
  sessionNavigatePathPattern,
  sessionPathPattern,
  sessionProjectParameter,
  sessionsPath,
  sessionStatsPathPattern,
  sessionTurnsPathPattern,
  type AgentContributionRegistration,
  type AgentsSnapshot,
  type AgentSummary,
  type ContributionRegistration,
  type SkillContributionRegistration,
  type Session,
  type SessionBranch,
  type SessionCompactAccepted,
  type SessionCompactRequest,
  type SessionContextUsage,
  type SessionDeleted,
  type SessionDraft,
  type SessionEntriesPage,
  type SessionEntryLabelled,
  type SessionForkRequest,
  type SessionLabelUpdate,
  type SessionMessage,
  type SessionMessageAccepted,
  type SessionNavigated,
  type SessionNavigateRequest,
  type SessionsSnapshot,
  type SessionStats,
  type SessionUpdate,
  type HookRefusal,
  type PlatformHookName,
  type TurnAccepted,
  type TurnRequest,
} from "@sovereign/protocol";
import type {
  AgentDefinition,
  AgentSession,
  AgentSessionStore,
  AgentSessionSummary,
  AgentSkill,
} from "@sovereign/agent-runtime-pi";

import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { EventBus } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";
import { probeProjectFolder } from "../projects/public.ts";
import type { ProjectStore, StoredProject } from "../projects/public.ts";
import type { ProjectLifecycle } from "../projects/public.ts";
import { describeRefusals } from "./hook-dispatch.ts";
import type { HookDispatcher } from "./hook-dispatch.ts";
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
  /** Global snapshot для общего каталога и project-resolved snapshot для сессии. */
  contributions: {
    base: () => ContributionRegistration[];
    forProject: (projectId: string) => ContributionRegistration[];
  };
  tools: ToolCollector;
  queue: TurnQueue;
  bus: Pick<EventBus, "publish">;
  emitDelta: SessionDeltaSink;
  logger: Logger;
  availability?: (project: StoredProject) => "available" | "missing";
  projectLifecycle?: ProjectLifecycle;
  /**
   * Доля контекстного окна, после которой компакция запускается сама. Спрашивается функцией по той
   * же причине, что и предел турнов: `config.json` применяется живьём. Отсутствие равно `0` —
   * автопорогу, которого нет, а не молча включённому (docs/sessions-and-projects.md).
   */
  compactionThreshold?: () => number;
  /**
   * Хуки платформы (docs/hooks.md). Необязательны: без подписчиков служба работает как раньше, а
   * тесты сессий о плагинах не знают вовсе.
   */
  hooks?: Pick<HookDispatcher, "observe" | "decide">;
};

/** Исход создания. Отказ домена — не исключение: маршрут переводит его в код, мост — в текст. */
export type CreateSessionOutcome =
  | { kind: "created"; session: Session }
  | { kind: "unknown-project" }
  | { kind: "refused"; reason: string }
  /**
   * Отказал подписчик, а не домен. Отдельный исход, потому что отказов может быть несколько и у
   * каждого назван автор: конфликт двух политик иначе выглядел бы как одна причина (docs/hooks.md).
   */
  | { kind: "refused-by-hooks"; refusals: HookRefusal[] };

export type PromptRequest = TurnRequest & { sessionId: string };

export type PromptOutcome =
  | { kind: "accepted"; turn: TurnAccepted }
  | { kind: "unknown" }
  | { kind: "refused"; reason: string };

/** Исход операции, отдающей изменённую или новую сессию: форк и запись изменений. */
export type SessionOutcome =
  { kind: "done"; session: Session } | { kind: "unknown" } | { kind: "refused"; reason: string };

export type SessionRemoveOutcome =
  { kind: "removed" } | { kind: "unknown" } | { kind: "refused"; reason: string };

export type SessionMessageOutcome =
  | { kind: "accepted"; accepted: SessionMessageAccepted }
  | { kind: "unknown" }
  | { kind: "refused"; reason: string };

/**
 * Исход запуска компакции. Как у турна: возврат значит «принята», а не «свёрнут контекст» —
 * компакция ходит к модели и ждёт своей очереди наравне с турном (docs/architecture.md).
 */
export type SessionCompactOutcome =
  | { kind: "accepted"; accepted: SessionCompactAccepted }
  | { kind: "unknown" }
  | { kind: "refused"; reason: string };

/**
 * Исход перехода по дереву. В отличие от компакции — дожидается результата: `editorText` доставить
 * вне ответа нечем, а лист без него бессмыслен (docs/sessions-and-projects.md).
 *
 * `unknown` покрывает и отсутствующую сессию, и отсутствующую запись: снаружи это один и тот же
 * «такого нет».
 */
export type SessionNavigateOutcome =
  | { kind: "done"; navigated: SessionNavigated }
  | { kind: "unknown" }
  | { kind: "refused"; reason: string };

export type SessionLabelOutcome =
  | { kind: "done"; labelled: SessionEntryLabelled }
  | { kind: "unknown" }
  | { kind: "refused"; reason: string };

export type SessionService = {
  /** Включённые агенты. Пустой список — законный ответ. */
  agents: () => AgentSummary[];
  /** Агенты после разрешения перекрытий в одном проекте. */
  agentsForProject: (projectId: string) => AgentSummary[];
  /** Действующие сессии; `archived` переключает список на архивные (docs/web-api.md). */
  list: (projectId?: string, archived?: boolean) => Session[];
  create: (draft: SessionDraft) => Promise<CreateSessionOutcome>;
  /** `undefined` — такой сессии нет. Архивная находится: убрана она с глаз, а не из системы. */
  entries: (sessionId: string, after?: number) => Promise<SessionEntriesPage | undefined>;
  prompt: (request: PromptRequest) => Promise<PromptOutcome>;
  /** `false` — прерывать было нечего. */
  abort: (sessionId: string) => Promise<boolean>;
  /** Новая сессия из куска этой. Форк рождается действующим, даже если источник архивный. */
  fork: (sessionId: string, request: SessionForkRequest) => Promise<SessionOutcome>;
  /** Переименование, архивация и восстановление — одна запись целой записи, как у проекта. */
  update: (sessionId: string, update: SessionUpdate) => Promise<SessionOutcome>;
  remove: (sessionId: string) => Promise<SessionRemoveOutcome>;
  /** Сообщение, которое не запускает турн: стиринг, догоняющее, к следующему турну, дозапись. */
  message: (sessionId: string, message: SessionMessage) => Promise<SessionMessageOutcome>;
  /** `undefined` — такой сессии нет. */
  stats: (sessionId: string) => Promise<SessionStats | undefined>;
  /**
   * Ветка дерева от записи или от листа. `undefined` — нет ни такой сессии, ни такой записи.
   * Архивная сессия читается: убрана она с глаз, а не из системы.
   */
  branch: (sessionId: string, from?: string) => Promise<SessionBranch | undefined>;
  /** Заполненность контекста действующей ветки вместе с действующим автопорогом. */
  contextUsage: (sessionId: string) => Promise<SessionContextUsage | undefined>;
  /** Свернуть контекст. Асинхронна, как турн: занимает слот в очереди походов к модели. */
  compact: (sessionId: string, request: SessionCompactRequest) => Promise<SessionCompactOutcome>;
  /** Перейти к записи дерева. Синхронна: результат нужен вызывающему целиком. */
  navigate: (sessionId: string, request: SessionNavigateRequest) => Promise<SessionNavigateOutcome>;
  /** Поставить или снять метку записи. Простоя не требует: это запись в дерево, а не перенос файла. */
  labelEntry: (
    sessionId: string,
    entryId: string,
    update: SessionLabelUpdate,
  ) => Promise<SessionLabelOutcome>;
  routes: () => Route[];
  /** Сколько сессий в папке проекта: считается по снимку списка, без похода на диск. */
  countByFolderKey: (folderKey: string) => number;
  /** Перечитать список с диска. Зовётся при старте и после создания сессии. */
  refresh: () => Promise<void>;
  close: () => Promise<void>;
};

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Имена хуков платформы названы типом протокола, а не строкой на месте: опечатка в имени означала бы
 * хук, на который невозможно подписаться, и заметить это было бы нечем (docs/hooks.md).
 */
const beforeSessionStart: PlatformHookName = "before_session_start";
const sessionCreated: PlatformHookName = "session_created";
const sessionClosed: PlatformHookName = "session_closed";
const turnFinished: PlatformHookName = "turn_finished";

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

  const agentsFor = (projectId?: string): AgentContributionRegistration[] =>
    (projectId === undefined
      ? options.contributions.base()
      : options.contributions.forProject(projectId)
    ).filter(
      (registration): registration is AgentContributionRegistration =>
        registration.kind === "agent",
    );

  const emptySelection = { include: [], exclude: [] };

  const agentDefinition = (agent: AgentContributionRegistration): AgentDefinition => ({
    id: agent.id,
    instructions: agent.instructions,
    ...(agent.location === undefined ? {} : { directory: dirname(agent.location) }),
  });

  const skillsFor = (
    contributions: ContributionRegistration[],
    agent: AgentContributionRegistration,
  ): AgentSkill[] => {
    const registrations = contributions.filter(
      (registration): registration is SkillContributionRegistration =>
        registration.kind === "skill" && registration.disableModelInvocation !== true,
    );
    const selected = new Set(
      selectNames(
        registrations.map((registration) => registration.id),
        agent.skills ?? emptySelection,
      ),
    );

    return registrations
      .filter((registration) => selected.has(registration.id))
      .map((registration) => ({
        name: registration.id,
        description: registration.description ?? "",
        location: registration.location,
      }));
  };

  const describeAgent = (agent: AgentContributionRegistration): AgentSummary => {
    const common = {
      id: agent.id,
      ...(agent.title === undefined ? {} : { title: agent.title }),
      ...(agent.description === undefined ? {} : { description: agent.description }),
      ...(agent.model === undefined ? {} : { model: agent.model }),
      ...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
      skills: {
        include: [...(agent.skills?.include ?? [])],
        exclude: [...(agent.skills?.exclude ?? [])],
      },
    };

    return agent.ownership === "plugin"
      ? {
          ...common,
          ownership: "plugin",
          pluginKey: agent.pluginKey,
          source: agent.source,
        }
      : {
          ...common,
          ownership: "standalone",
          source: agent.source,
          scope: agent.scope,
          ...(agent.projectId === undefined ? {} : { projectId: agent.projectId }),
        };
  };

  const describeSession = (summary: AgentSessionSummary): Session => ({
    id: summary.id,
    projectId: summary.projectId,
    folder: summary.folder,
    agentId: summary.agentId,
    agentAvailable: agentsFor(summary.projectId).some((agent) => agent.id === summary.agentId),
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

      const agent = agentsFor(summary.projectId).find(
        (candidate) => candidate.id === summary.agentId,
      );

      if (agent === undefined) {
        return {
          kind: "unavailable",
          reason: `the agent ${summary.agentId} is not available`,
        } as const;
      }

      const persisted = await options.store.open(sessionId);

      if (persisted === undefined) {
        return { kind: "unknown" } as const;
      }

      const activated = persisted.activate(agentDefinition(agent));

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

  /**
   * Активный набор инструментов на прошлом турне каждой сессии. Нужен потому, что «инструмент
   * исчез» — это разница между двумя моментами, и нигде, кроме памяти, она не лежит: сборка знает
   * только то, что есть сейчас.
   */
  const activeTools = new Map<string, string[]>();

  /**
   * Сказать, что сессия лишилась опоры и доигрывает без неё. След остаётся в двух местах: в дереве
   * сессии — для человека, который потом будет разбираться, почему агент повёл себя иначе; на шине —
   * для всех, кто смотрит за сессией сейчас, включая плагины (docs/sessions-and-projects.md).
   */
  const noteDegradation = async (
    sessionId: string,
    kind: "tool" | "model",
    name: string,
  ): Promise<void> => {
    const persisted = await options.store.open(sessionId);

    await persisted?.noteDegradation(kind, name);
    options.bus.publish(coreEventTypes.sessionDegraded, { sessionId, kind, name });
  };

  /** Набор инструментов пересобирается перед каждым турном: сессия доигрывает с тем, что осталось. */
  const applyRuntimeDefinitions = async (
    session: AgentSession,
    projectId: string,
    agent: AgentContributionRegistration,
    folder: string,
    contributions: ContributionRegistration[],
  ): Promise<void> => {
    const collected = await options.tools.collect({ projectId, folder });

    for (const problem of collected.problems) {
      options.logger.warn("a tool source did not answer", { problem });
    }

    const names = collected.tools.map((tool) => tool.name);
    const active = selectNames(names, agent.tools ?? emptySelection);
    const sessionId = session.summary().id;
    const before = activeTools.get(sessionId) ?? [];

    await session.setTools(
      collected.tools.map((tool) => ({ name: tool.name, tool: tool.tool })),
      active,
    );
    activeTools.set(sessionId, active);
    const definition = agentDefinition(agent);

    session.setInstructions(definition.instructions);
    session.setAgentDirectory(definition.directory);
    session.setSkills(skillsFor(contributions, agent));

    // Первый турн сравнивать не с чем: до него у сессии не было набора, а не «был и опустел».
    for (const lost of before.filter((name) => !active.includes(name))) {
      await noteDegradation(sessionId, "tool", lost);
    }
  };

  const prepareForModel = async (
    session: AgentSession,
    summary: AgentSessionSummary,
  ): Promise<{ kind: "ready" } | { kind: "missing-agent"; agentId: string }> => {
    const contributions = options.contributions.forProject(summary.projectId);
    const currentAgent = contributions.find(
      (registration): registration is AgentContributionRegistration =>
        registration.kind === "agent" && registration.id === summary.agentId,
    );

    if (currentAgent === undefined) {
      return { kind: "missing-agent", agentId: summary.agentId };
    }

    await applyRuntimeDefinitions(
      session,
      summary.projectId,
      currentAgent,
      summary.folder,
      contributions,
    );

    return { kind: "ready" };
  };

  /** Операции. Маршруты и мост плагинов зовут их одни и те же: набор обязан быть один. */
  const agents = (): AgentSummary[] => agentsFor().map(describeAgent);
  const agentsForProject = (projectId: string): AgentSummary[] =>
    agentsFor(projectId).map(describeAgent);

  const visible = (summary: AgentSessionSummary): boolean => {
    const project = options.projects.find(summary.projectId);

    return project !== undefined && !project.archived;
  };

  const list = (projectId?: string, archived = false): Session[] =>
    summaries
      .filter((summary) => projectId === undefined || summary.projectId === projectId)
      .filter((summary) => summary.archived === archived)
      .filter(visible)
      .map(describeSession);

  /**
   * Сессия по идентификатору, без фильтра архива: убранная с глаз сессия по прямому адресу
   * читается — иначе её нельзя было бы ни посмотреть, ни вернуть (docs/sessions-and-projects.md).
   */
  const find = (sessionId: string): AgentSessionSummary | undefined => {
    if (!isSessionId(sessionId)) {
      return undefined;
    }

    const summary = summaries.find((candidate) => candidate.id === sessionId);

    return summary !== undefined && visible(summary) ? summary : undefined;
  };

  /**
   * Забыть открытую сессию. Зовётся после того, как стор её отпустил: у него уже нет ни harness, ни
   * файла по прежнему пути, и держать здесь ссылку на мёртвый экземпляр значило бы отдать его
   * следующему обращению.
   */
  const forget = (sessionId: string): void => {
    live.delete(sessionId);
    places.delete(sessionId);
    activeTools.delete(sessionId);
  };

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

      const agent = agentsFor(draft.projectId).find((candidate) => candidate.id === draft.agentId);

      if (agent === undefined) {
        return { kind: "refused", reason: `the agent ${draft.agentId} is not available` };
      }

      const model = draft.model ?? agent.model;

      if (model === undefined) {
        return {
          kind: "refused",
          reason: `the agent ${agent.id} names no default model, so the model has to be named`,
        };
      }

      // До первой траты и до появления файла: отказ здесь означает, что сессии не будет вовсе
      // (docs/hooks.md). Спрашивается после проверок домена — подписчику незачем решать за
      // недоступную папку или несуществующего агента.
      const decision = await options.hooks?.decide(
        beforeSessionStart,
        { projectId: project.id, folder: project.folder, agentId: agent.id },
        { projectId: project.id },
      );

      if (decision !== undefined && decision.refusals.length > 0) {
        return { kind: "refused-by-hooks", refusals: decision.refusals };
      }

      const created = await options.store.create({
        projectId: project.id,
        agentId: agent.id,
        folder: project.folder,
        folderKey: project.folderKey,
        model,
        thinkingLevel: draft.thinkingLevel ?? agent.thinkingLevel ?? "off",
        agent: agentDefinition(agent),
      });

      if ("kind" in created) {
        return { kind: "refused", reason: `the model ${model} is not available right now` };
      }

      watch(created);
      live.set(created.summary().id, created);
      await refresh();
      announce();

      options.hooks?.observe(
        sessionCreated,
        { sessionId: created.summary().id, projectId: project.id, agentId: agent.id },
        { projectId: project.id },
      );

      return { kind: "created", session: describeSession(created.summary()) };
    });

  const entries = async (
    sessionId: string,
    after?: number,
  ): Promise<SessionEntriesPage | undefined> => {
    if (find(sessionId) === undefined) {
      return undefined;
    }

    const persisted = await options.store.open(sessionId);

    if (persisted === undefined) {
      return undefined;
    }

    const from = after !== undefined && Number.isSafeInteger(after) && after > 0 ? after : 0;

    return { sessionId, ...(await persisted.entries(from)) };
  };

  const stats = async (sessionId: string): Promise<SessionStats | undefined> => {
    if (find(sessionId) === undefined) {
      return undefined;
    }

    const persisted = await options.store.open(sessionId);

    return persisted === undefined ? undefined : { sessionId, ...(await persisted.stats()) };
  };

  /** Запись сессии на диске. Отдельно от `openSession`: чтение harness не поднимает. */
  const record = async (sessionId: string) => {
    if (find(sessionId) === undefined) {
      return undefined;
    }

    return options.store.open(sessionId);
  };

  const branch = async (sessionId: string, from?: string): Promise<SessionBranch | undefined> => {
    const persisted = await record(sessionId);

    if (persisted === undefined) {
      return undefined;
    }

    const found = await persisted.branch(from);

    // Нет такой записи — то же «не найдено», что и нет такой сессии: клиенту различать их не по
    // чему, он просил одну ветку и не получил её.
    if (found.kind === "unknown-entry") {
      return undefined;
    }

    return {
      sessionId,
      entries: found.entries,
      ...(found.leafId === undefined ? {} : { leafId: found.leafId }),
    };
  };

  const thresholdOf = (): number => options.compactionThreshold?.() ?? 0;

  const contextUsage = async (sessionId: string): Promise<SessionContextUsage | undefined> => {
    const persisted = await record(sessionId);

    if (persisted === undefined) {
      return undefined;
    }

    const counted = await persisted.contextUsage();

    return {
      sessionId,
      tokens: counted.tokens,
      ...(counted.contextWindow === undefined ? {} : { contextWindow: counted.contextWindow }),
      threshold: thresholdOf(),
    };
  };

  const labelEntry = async (
    sessionId: string,
    entryId: string,
    update: SessionLabelUpdate,
  ): Promise<SessionLabelOutcome> => {
    const summary = find(sessionId);

    if (summary === undefined) {
      return { kind: "unknown" };
    }

    // Архивная сессия читается, но не пишется: та же граница, что у турна и компакции. Простоя
    // метка при этом не требует — это запись в дерево, а не перенос файла.
    if (summary.archived) {
      return { kind: "refused", reason: "the session is archived" };
    }

    const persisted = await options.store.open(sessionId);

    if (persisted === undefined) {
      return { kind: "unknown" };
    }

    const written = await persisted.label(entryId, update.label);

    if (written.kind === "unknown-entry") {
      return { kind: "unknown" };
    }

    return {
      kind: "done",
      labelled: {
        sessionId,
        entryId,
        ...(update.label === null ? {} : { label: update.label }),
      },
    };
  };

  /**
   * Живая сессия, готовая к походу к модели. Общее начало компакции и навигации: обе требуют
   * поднятого harness, действующего агента и незанятой сессии — ровно как турн.
   */
  const readyForModel = async (
    sessionId: string,
  ): Promise<
    | { kind: "ready"; session: AgentSession }
    | { kind: "unknown" }
    | { kind: "refused"; reason: string }
  > => {
    const summary = find(sessionId);

    if (summary === undefined) {
      return { kind: "unknown" };
    }

    if (summary.archived) {
      return { kind: "refused", reason: "the session is archived" };
    }

    const contributions = options.contributions.forProject(summary.projectId);
    const currentAgent = contributions.find(
      (registration): registration is AgentContributionRegistration =>
        registration.kind === "agent" && registration.id === summary.agentId,
    );

    if (currentAgent === undefined) {
      return { kind: "refused", reason: `the agent ${summary.agentId} is not available` };
    }

    const opened = await openSession(sessionId);

    if (opened.kind === "unknown") {
      return { kind: "unknown" };
    }

    if (opened.kind === "unavailable") {
      return { kind: "refused", reason: opened.reason };
    }

    if (phaseOf(sessionId) !== "idle") {
      return { kind: "refused", reason: "the session is busy" };
    }

    return { kind: "ready", session: opened.session };
  };

  /**
   * Запустить компакцию. `automatic` различает просьбу человека и решение автопорога: только у
   * второй по окончании стоит перепроверить контекст — и только один раз, иначе сессия, которая не
   * влезает в окно даже свёрнутой, ходила бы к модели бесконечно.
   */
  const startCompaction = async (
    sessionId: string,
    request: SessionCompactRequest,
    automatic: boolean,
  ): Promise<SessionCompactOutcome> => {
    const ready = await readyForModel(sessionId);

    if (ready.kind !== "ready") {
      return ready;
    }

    const place = options.queue.reserve(sessionId);

    if (place.kind === "busy") {
      return { kind: "refused", reason: "the session is busy" };
    }

    const prepared = await prepareForModel(ready.session, ready.session.summary());

    if (prepared.kind === "missing-agent") {
      place.release();
      return { kind: "refused", reason: `the agent ${prepared.agentId} is not available` };
    }

    const tracked = { turnId: place.turnId, cancel: place.cancel, validating: false };

    places.set(sessionId, tracked);

    const started = place.start({
      kind: "compaction",
      run: async (turnId, queued) => {
        try {
          if (queued) {
            const prepared = await prepareForModel(ready.session, ready.session.summary());

            if (prepared.kind === "missing-agent") {
              options.emitDelta({
                sessionId,
                turnId,
                delta: {
                  kind: "turn-failed",
                  reason: `the agent ${prepared.agentId} is not available`,
                },
              });
              options.logger.warn("a queued compaction lost its agent", {
                session: sessionId,
                agent: prepared.agentId,
              });
              return;
            }
          }

          const outcome = await ready.session.compact(request.instructions);

          if (outcome.kind !== "done") {
            options.logger.warn("a compaction did not go through", {
              session: sessionId,
              reason: outcome.kind === "busy" ? "the session is busy" : outcome.reason,
            });
          }
        } finally {
          places.delete(sessionId);

          if (automatic) {
            scheduleThresholdCheck(sessionId, true);
          }
        }
      },
    });

    if (started === undefined) {
      places.delete(sessionId);

      return { kind: "refused", reason: "the compaction was cancelled" };
    }

    if (started.state === "queued") {
      options.emitDelta({
        sessionId,
        turnId: started.turnId,
        delta: { kind: "phase", phase: "queued" },
      });
    }

    announce();

    return { kind: "accepted", accepted: { sessionId, phase: phaseOf(sessionId) } };
  };

  const compact = (
    sessionId: string,
    request: SessionCompactRequest,
  ): Promise<SessionCompactOutcome> => startCompaction(sessionId, request, false);

  const navigate = async (
    sessionId: string,
    request: SessionNavigateRequest,
  ): Promise<SessionNavigateOutcome> => {
    const ready = await readyForModel(sessionId);

    if (ready.kind !== "ready") {
      return ready;
    }

    const session = ready.session;

    // Переход без пересказа к модели не ходит, поэтому слот очереди ему не нужен: очередь считает
    // походы к модели, а не любые операции над сессией (docs/architecture.md).
    if (request.summarize !== true) {
      return describeNavigation(sessionId, await session.navigate(request));
    }

    const place = options.queue.reserve(sessionId);

    if (place.kind === "busy") {
      return { kind: "refused", reason: "the session is busy" };
    }

    const prepared = await prepareForModel(session, session.summary());

    if (prepared.kind === "missing-agent") {
      place.release();
      return { kind: "refused", reason: `the agent ${prepared.agentId} is not available` };
    }

    places.set(sessionId, { turnId: place.turnId, cancel: place.cancel, validating: false });

    let settle: (outcome: Awaited<ReturnType<AgentSession["navigate"]>>) => void = () => undefined;
    const finished = new Promise<Awaited<ReturnType<AgentSession["navigate"]>>>((resolve) => {
      settle = resolve;
    });

    const started = place.start({
      kind: "branch-summary",
      run: async (_turnId, queued) => {
        try {
          if (queued) {
            const prepared = await prepareForModel(session, session.summary());

            if (prepared.kind === "missing-agent") {
              settle({
                kind: "failed",
                reason: `the agent ${prepared.agentId} is not available`,
              });
              return;
            }
          }

          settle(await session.navigate(request));
        } catch (cause) {
          // Ждущий обязан получить ответ даже на сбое: иначе запрос повис бы навсегда.
          settle({ kind: "failed", reason: describeCause(cause) });

          throw cause;
        } finally {
          places.delete(sessionId);
        }
      },
    });

    if (started === undefined) {
      places.delete(sessionId);

      return { kind: "refused", reason: "the navigation was cancelled" };
    }

    if (started.state === "queued") {
      options.emitDelta({
        sessionId,
        turnId: started.turnId,
        delta: { kind: "phase", phase: "queued" },
      });
    }

    announce();

    return describeNavigation(sessionId, await finished);
  };

  const describeNavigation = (
    sessionId: string,
    moved: Awaited<ReturnType<AgentSession["navigate"]>>,
  ): SessionNavigateOutcome => {
    if (moved.kind === "unknown-entry") {
      return { kind: "unknown" };
    }

    if (moved.kind === "busy") {
      return { kind: "refused", reason: "the session is busy" };
    }

    if (moved.kind === "failed") {
      options.logger.warn("a navigation failed", { session: sessionId, reason: moved.reason });

      return { kind: "refused", reason: moved.reason };
    }

    announce();

    return {
      kind: "done",
      navigated: {
        sessionId,
        ...(moved.leafId === undefined ? {} : { leafId: moved.leafId }),
        ...(moved.editorText === undefined ? {} : { editorText: moved.editorText }),
        summarized: moved.summarized,
      },
    };
  };

  /**
   * Проверить автопорог после того, как сессия вернулась в простой. Именно после: слот очереди
   * освобождается на выходе из работы, а изнутри работы места в очереди не получить.
   */
  const scheduleThresholdCheck = (sessionId: string, afterCompaction = false): void => {
    setImmediate(() => {
      void considerCompaction(sessionId, afterCompaction);
    });
  };

  const considerCompaction = async (sessionId: string, afterCompaction: boolean): Promise<void> => {
    const threshold = thresholdOf();

    if (closing || threshold <= 0) {
      return;
    }

    const counted = await contextUsage(sessionId);

    // Без окна доли не существует: модель сессии пропала из каталога, и сравнивать не с чем.
    if (counted?.contextWindow === undefined) {
      return;
    }

    if (counted.tokens <= counted.contextWindow * threshold) {
      return;
    }

    if (afterCompaction) {
      // Второй раз подряд не запускаем: контекст, не влезающий в порог даже свёрнутым, иначе гонял
      // бы компакцию по кругу за деньги владельца.
      options.logger.warn("the context stayed above the compaction threshold after compacting", {
        session: sessionId,
        tokens: counted.tokens,
        contextWindow: counted.contextWindow,
        threshold,
      });

      return;
    }

    const started = await startCompaction(sessionId, {}, true);

    if (started.kind !== "accepted") {
      options.logger.warn("the automatic compaction did not start", {
        session: sessionId,
        reason: started.kind === "unknown" ? "the session is gone" : started.reason,
      });
    }
  };

  const fork = async (sessionId: string, request: SessionForkRequest): Promise<SessionOutcome> => {
    if (find(sessionId) === undefined) {
      return { kind: "unknown" };
    }

    const forked = await options.store.fork(sessionId, request);

    if (forked.kind === "unknown-session") {
      return { kind: "unknown" };
    }

    if (forked.kind === "refused") {
      return { kind: "refused", reason: forked.reason };
    }

    await refresh();
    announce();

    return { kind: "done", session: describeSession(forked.session.summary()) };
  };

  const update = async (sessionId: string, wanted: SessionUpdate): Promise<SessionOutcome> => {
    const summary = find(sessionId);

    if (summary === undefined) {
      return { kind: "unknown" };
    }

    const moving = summary.archived !== wanted.archived;

    // Архивация и разархив двигают файл, а дописывать в движущийся файл нельзя: сначала простой,
    // потом перенос. Переименование этого не требует — оно обычная запись в дерево.
    if (moving && phaseOf(sessionId) !== "idle") {
      return { kind: "refused", reason: "the session is busy" };
    }

    if (wanted.title !== summary.name) {
      const persisted = await options.store.open(sessionId);

      if (persisted === undefined) {
        return { kind: "unknown" };
      }

      await persisted.setName(wanted.title ?? "");
    }

    if (moving) {
      const moved = wanted.archived
        ? await options.store.archive(sessionId)
        : await options.store.restore(sessionId);

      if (moved.kind === "unknown-session") {
        return { kind: "unknown" };
      }

      forget(sessionId);
    }

    await refresh();
    announce();

    const written = summaries.find((candidate) => candidate.id === sessionId);

    return written === undefined
      ? { kind: "unknown" }
      : { kind: "done", session: describeSession(written) };
  };

  const remove = async (sessionId: string): Promise<SessionRemoveOutcome> => {
    if (find(sessionId) === undefined) {
      return { kind: "unknown" };
    }

    // Та же причина, что у архива: стирать файл, в который идёт дозапись, — гонка. Каскада здесь
    // нет — форки живут своей жизнью (docs/sessions-and-projects.md).
    if (phaseOf(sessionId) !== "idle") {
      return { kind: "refused", reason: "the session is busy" };
    }

    const removed = find(sessionId);

    if (!(await options.store.remove(sessionId))) {
      return { kind: "unknown" };
    }

    forget(sessionId);
    await refresh();
    announce();

    // Закрытие — это удаление сессии, а не выгрузка harness из памяти и не архивация: убранная с
    // глаз сессия остаётся в системе и читается по прямому адресу (docs/sessions-and-projects.md).
    if (removed !== undefined) {
      options.hooks?.observe(
        sessionClosed,
        { sessionId, projectId: removed.projectId },
        { projectId: removed.projectId },
      );
    }

    return { kind: "removed" };
  };

  const message = async (
    sessionId: string,
    wanted: SessionMessage,
  ): Promise<SessionMessageOutcome> => {
    const summary = find(sessionId);

    if (summary === undefined) {
      return { kind: "unknown" };
    }

    if (summary.archived) {
      return { kind: "refused", reason: "the session is archived" };
    }

    if (!agentsFor(summary.projectId).some((agent) => agent.id === summary.agentId)) {
      return { kind: "refused", reason: `the agent ${summary.agentId} is not available` };
    }

    // Стиринг и догоняющее требуют идущего турна, а идущий турн бывает только у поднятой сессии:
    // если harness не поднят, поднимать его незачем — очередь всё равно окажется пустой.
    if (
      (wanted.mode === "steer" || wanted.mode === "follow-up") &&
      live.get(sessionId) === undefined
    ) {
      return { kind: "refused", reason: "the session is idle" };
    }

    const opened = await openSession(sessionId);

    if (opened.kind === "unknown") {
      return { kind: "unknown" };
    }

    if (opened.kind === "unavailable") {
      return { kind: "refused", reason: opened.reason };
    }

    const prepared = await prepareForModel(opened.session, summary);

    if (prepared.kind === "missing-agent") {
      return { kind: "refused", reason: `the agent ${prepared.agentId} is not available` };
    }

    const outcome = await opened.session.message(wanted.text, wanted.mode);

    if (outcome.kind === "idle") {
      return { kind: "refused", reason: "the session is idle" };
    }

    if (outcome.kind === "busy") {
      return { kind: "refused", reason: "the session is busy" };
    }

    return { kind: "accepted", accepted: { sessionId, mode: wanted.mode } };
  };

  const prompt = async (request: PromptRequest): Promise<PromptOutcome> => {
    const sessionId = request.sessionId;
    const ready = await readyForModel(sessionId);

    if (ready.kind !== "ready") {
      return ready;
    }

    const session = ready.session;
    const summary = session.summary();

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

        // Модель сессии пропала из каталога, пока сессия жила: отказ турна — половина ответа,
        // вторая половина в том, что об этом видно и постфактум (docs/sessions-and-projects.md).
        await noteDegradation(sessionId, "model", summary.model);

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

      const prepared = await prepareForModel(session, summary);

      if (prepared.kind === "missing-agent") {
        place.release();
        places.delete(sessionId);
        return { kind: "refused", reason: `the agent ${prepared.agentId} is not available` };
      }

      if (place.cancelled()) {
        place.release();
        places.delete(sessionId);
        return { kind: "refused", reason: "the turn was cancelled" };
      }
    } catch (cause) {
      place.release();
      places.delete(sessionId);

      throw cause;
    }

    const started = place.start({
      kind: "turn",
      run: async (turnId, queued) => {
        try {
          if (queued) {
            const prepared = await prepareForModel(session, session.summary());

            if (prepared.kind === "missing-agent") {
              options.emitDelta({
                sessionId,
                turnId,
                delta: {
                  kind: "turn-failed",
                  reason: `the agent ${prepared.agentId} is not available`,
                },
              });
              return;
            }
          }

          const outcome = await session.prompt(request.text, turnId);

          if (outcome.kind === "failed") {
            options.logger.warn("a turn failed", { session: sessionId, reason: outcome.reason });
          }

          if (outcome.kind === "done") {
            // Трата уезжает типом рантайма и непрозрачной: своего отчёта мы не заводим, а ядру
            // разбирать его незачем — типизирует его SDK (docs/hooks.md).
            options.hooks?.observe(
              turnFinished,
              {
                sessionId,
                projectId: session.summary().projectId,
                ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
              },
              { projectId: session.summary().projectId },
            );
          }
        } finally {
          places.delete(sessionId);
          scheduleThresholdCheck(sessionId);
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
    agentsForProject,
    list,
    create,
    entries,
    prompt,
    abort,
    fork,
    update,
    remove,
    message,
    stats,
    branch,
    contextUsage,
    compact,
    navigate,
    labelEntry,
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
            sessions: list(
              projectId ?? undefined,
              url.searchParams.get(sessionArchivedParameter) === "true",
            ),
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

          if (created.kind === "refused-by-hooks") {
            // Тот же код, что у отказа домена, и та же форма плюс список: клиенту незачем различать,
            // кто именно запретил, а вот показать человеку авторов отказа он обязан (docs/hooks.md).
            respondWithJson(response, 409, {
              error: describeRefusals(created.refusals),
              refusals: created.refusals,
            });

            return;
          }

          respondWithJson(response, 200, created.session);
        },
      },
      {
        method: "GET",
        path: sessionPathPattern,
        handle: ({ response, parameters }) => {
          // По прямому адресу читается и архивная: она убрана с глаз, а не из системы.
          const found = find(parameters["sessionId"] ?? "");

          if (found === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, describeSession(found));
        },
      },
      {
        method: "PUT",
        path: sessionPathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionUpdate(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const written = await update(parameters["sessionId"] ?? "", parsed.value);

          if (written.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (written.kind === "refused") {
            respondWithError(response, 409, written.reason);

            return;
          }

          respondWithJson(response, 200, written.session);
        },
      },
      {
        method: "DELETE",
        path: sessionPathPattern,
        handle: async ({ response, parameters }) => {
          const sessionId = parameters["sessionId"] ?? "";
          const removed = await remove(sessionId);

          if (removed.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (removed.kind === "refused") {
            respondWithError(response, 409, removed.reason);

            return;
          }

          const answer: SessionDeleted = { id: sessionId };

          respondWithJson(response, 200, answer);
        },
      },
      {
        method: "POST",
        path: sessionForkPathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionForkRequest(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const forked = await fork(parameters["sessionId"] ?? "", parsed.value);

          if (forked.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (forked.kind === "refused") {
            respondWithError(response, 409, forked.reason);

            return;
          }

          respondWithJson(response, 200, forked.session);
        },
      },
      {
        method: "POST",
        path: sessionMessagesPathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionMessage(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const accepted = await message(parameters["sessionId"] ?? "", parsed.value);

          if (accepted.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (accepted.kind === "refused") {
            respondWithError(response, 409, accepted.reason);

            return;
          }

          respondWithJson(response, 200, accepted.accepted);
        },
      },
      {
        method: "GET",
        path: sessionStatsPathPattern,
        handle: async ({ response, parameters }) => {
          const counted = await stats(parameters["sessionId"] ?? "");

          if (counted === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, counted);
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
        method: "GET",
        path: sessionBranchPathPattern,
        handle: async ({ response, parameters, url }) => {
          const from = url.searchParams.get(sessionBranchFromParameter);
          const found = await branch(parameters["sessionId"] ?? "", from ?? undefined);

          if (found === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, found);
        },
      },
      {
        method: "GET",
        path: sessionContextPathPattern,
        handle: async ({ response, parameters }) => {
          const counted = await contextUsage(parameters["sessionId"] ?? "");

          if (counted === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, counted);
        },
      },
      {
        method: "POST",
        path: sessionCompactPathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionCompactRequest(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const accepted = await compact(parameters["sessionId"] ?? "", parsed.value);

          if (accepted.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (accepted.kind === "refused") {
            respondWithError(response, 409, accepted.reason);

            return;
          }

          respondWithJson(response, 202, accepted.accepted);
        },
      },
      {
        method: "POST",
        path: sessionNavigatePathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionNavigateRequest(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const moved = await navigate(parameters["sessionId"] ?? "", parsed.value);

          if (moved.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (moved.kind === "refused") {
            respondWithError(response, 409, moved.reason);

            return;
          }

          respondWithJson(response, 200, moved.navigated);
        },
      },
      {
        method: "PUT",
        path: sessionEntryLabelPathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionLabelUpdate(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          const written = await labelEntry(
            parameters["sessionId"] ?? "",
            parameters["entryId"] ?? "",
            parsed.value,
          );

          if (written.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (written.kind === "refused") {
            respondWithError(response, 409, written.reason);

            return;
          }

          respondWithJson(response, 200, written.labelled);
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

          if (find(sessionId) === undefined) {
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
