/**
 * Сессии агента через веб-API (docs/sessions-and-projects.md).
 *
 * Сессия живёт в ядре, а не в плагине, который её создал: выгрузка плагина её не останавливает
 * (docs/architecture.md). Здесь же сходятся три вещи, до этого жившие порознь: сборка набора
 * инструментов, очередь походов к модели и поток дельт.
 */

import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  agentsPath,
  coreEventTypes,
  defaultConfig,
  isCoreSessionCommandName,
  isSessionId,
  parseSessionCompactRequest,
  parseSessionDraft,
  parseSessionForkRequest,
  parseSessionLabelUpdate,
  parseSessionMessage,
  parseSessionNavigateRequest,
  parseSessionOutboxAction,
  parseSessionOutboxRequest,
  parseSessionOutboxUpdate,
  parseSessionUpdate,
  parseTurnRequest,
  selectNames,
  sessionArchivedParameter,
  sessionBranchFromParameter,
  sessionBranchPathPattern,
  sessionCommandsPathPattern,
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
  sessionQueuedMessagePathPattern,
  sessionQueuePathPattern,
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
  type SessionCommands,
  type SessionCompactAccepted,
  type SessionCompactRequest,
  type SessionContextUsage,
  type SessionDeleted,
  type SessionDraft,
  type SessionEntriesPage,
  type SessionEntryLabelled,
  type SessionForkRequest,
  type SessionLabelUpdate,
  type SessionImage,
  type SessionMessage,
  type SessionMessageAccepted,
  type SessionNavigated,
  type SessionNavigateRequest,
  type SessionOutbox,
  type SessionOutboxRequest,
  type SessionsSnapshot,
  type SessionStats,
  type SessionUpdate,
  type HookRefusal,
  type PlatformHookName,
  type TurnAccepted,
  type TurnRequest,
} from "@sovereign/protocol";
import { loadPromptTemplates } from "@sovereign/agent-runtime-pi";
import type {
  AgentDefinition,
  AgentSession,
  AgentSessionStore,
  AgentSessionSummary,
  AgentSkill,
  InvokedSkill,
  PersistedAgentSession,
  PromptTemplate,
  PromptTemplateRoot,
  TurnOutcome,
} from "@sovereign/agent-runtime-pi";

import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { EventBus } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";
import { probeProjectFolder } from "../projects/public.ts";
import type { ProjectStore, StoredProject } from "../projects/public.ts";
import type { ProjectLifecycle } from "../projects/public.ts";
import { describeRefusals } from "./hook-dispatch.ts";
import type { HookDispatcher } from "./hook-dispatch.ts";
import {
  bodyLimitFor,
  entriesImageBytes,
  imagesBytes,
  refuseMessageImages,
  refuseSessionImageBudget,
  type ImageLimits,
} from "./image-limits.ts";
import { createMessageOutbox } from "./message-outbox.ts";
import type { ToolCollector } from "./tool-collection.ts";
import type { TurnLane, TurnQueue } from "./turn-queue.ts";

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
   * Пределы на изображения в сообщениях. Спрашиваются функцией по той же причине, что и остальные
   * значения конфига: `config.json` применяется живьём, и сессия, открытая до правки, обязана
   * увидеть новое число (docs/data-directory.md).
   */
  imageLimits?: () => ImageLimits;
  /**
   * Хуки платформы (docs/hooks.md). Необязательны: без подписчиков служба работает как раньше, а
   * тесты сессий о плагинах не знают вовсе.
   */
  hooks?: Pick<HookDispatcher, "observe" | "decide">;
  /**
   * Корень пользовательских шаблонов промптов — `commands/` директории данных
   * (docs/file-resources.md). Не задан — пользовательских шаблонов нет: службе, поднятой в тесте,
   * директории данных знать неоткуда.
   */
  commandsDirectory?: string;
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
  /**
   * `status` называет код, если он не обычный `409`. Отдельного исхода на каждый код нет: отказ
   * остаётся одним понятием домена, а маршрут переводит его в HTTP — слишком велика нагрузка это
   * `413`, а «в сессии больше нет места» — состояние сессии, то есть `409` (docs/web-api.md).
   */
  | { kind: "refused"; reason: string; status?: 413 | 409 };

/**
 * Исход чтения каталога команд. Отсутствующий агент — отказ, а не пустой каталог: пустой каталог
 * человек читает как «скилов нет», а исчезнувший плагин с агентом — совсем другая беда.
 */
export type SessionCommandsOutcome =
  | { kind: "commands"; commands: SessionCommands }
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
  | { kind: "refused"; reason: string; status?: 413 | 409 };

/**
 * Исход действия над очередью. Отдаётся снимок целиком, а не изменённое сообщение: очередь
 * показывается списком, и клиент, получивший один элемент, всё равно спросил бы остальные.
 */
export type SessionOutboxOutcome =
  | { kind: "done"; outbox: SessionOutbox }
  | { kind: "unknown" }
  | { kind: "refused"; reason: string; status?: 413 | 409 };

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
  /** Что предлагает композер по `/`: скилы, применимые к этой сессии (docs/web-api.md). */
  commands: (sessionId: string) => Promise<SessionCommandsOutcome>;
  /** `false` — прерывать было нечего. */
  abort: (sessionId: string) => Promise<boolean>;
  /** Новая сессия из куска этой. Форк рождается действующим, даже если источник архивный. */
  fork: (sessionId: string, request: SessionForkRequest) => Promise<SessionOutcome>;
  /** Переименование, архивация и восстановление — одна запись целой записи, как у проекта. */
  update: (sessionId: string, update: SessionUpdate) => Promise<SessionOutcome>;
  remove: (sessionId: string) => Promise<SessionRemoveOutcome>;
  /** Сообщение, которое не запускает турн: стиринг, догоняющее, дозапись. */
  message: (sessionId: string, message: SessionMessage) => Promise<SessionMessageOutcome>;
  /** Что ждёт своей очереди. `undefined` — такой сессии нет. */
  queued: (sessionId: string) => SessionOutbox | undefined;
  /** Поставить сообщение в очередь. Простаивающая сессия запустит его сразу же. */
  enqueue: (sessionId: string, request: SessionOutboxRequest) => Promise<SessionOutboxOutcome>;
  /** Снять остановку очереди и попробовать снова. */
  resumeQueue: (sessionId: string) => SessionOutboxOutcome;
  /** Вклинить ждущее сообщение в идущий турн, не дожидаясь его конца. */
  steerQueued: (sessionId: string, messageId: string) => Promise<SessionOutboxOutcome>;
  /** Снять сообщение с очереди. */
  dropQueued: (sessionId: string, messageId: string) => SessionOutboxOutcome;
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

/** Ответ у всех пяти маршрутов очереди один — её снимок, поэтому и перевод исхода в HTTP один. */
function respondWithOutbox(
  response: Parameters<typeof respondWithJson>[0],
  outcome: SessionOutboxOutcome,
): void {
  if (outcome.kind === "unknown") {
    respondWithError(response, 404, "not found");

    return;
  }

  if (outcome.kind === "refused") {
    respondWithError(response, outcome.status ?? 409, outcome.reason);

    return;
  }

  respondWithJson(response, 200, outcome.outbox);
}

/**
 * Имена хуков платформы названы типом протокола, а не строкой на месте: опечатка в имени означала бы
 * хук, на который невозможно подписаться, и заметить это было бы нечем (docs/hooks.md).
 */
const beforeSessionStart: PlatformHookName = "before_session_start";
const sessionCreated: PlatformHookName = "session_created";
const sessionClosed: PlatformHookName = "session_closed";
const turnFinished: PlatformHookName = "turn_finished";

/**
 * Предел размера `SKILL.md` на явном запуске. Совпадает с пределом обхода файловых ресурсов
 * намеренно: файл уже прошёл его при регистрации, и второе число здесь означало бы скил, который
 * реестр принял, а запустить нельзя. Своей константой, а не общей: обход живёт в области плагинов,
 * а сессии на неё не опираются (docs/architecture.md).
 */
const maximumSkillBytes = 1_048_576;

/**
 * Предел имени, сгенерированного из первого сообщения. Больше в строке сайдбара не помещается,
 * а имя всё равно переименовываемое: точную формулировку человек поправит руками.
 */
const maximumGeneratedSessionNameLength = 60;

/**
 * Имя сессии из первого сообщения: первая непустая строка, усечённая до предела с многоточием.
 * Вызывающий гарантирует непустой текст, поэтому пустого результата здесь не бывает.
 */
function sessionNameFromMessage(text: string): string {
  const line =
    text
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== "") ?? text.trim();

  return line.length <= maximumGeneratedSessionNameLength
    ? line
    : `${line.slice(0, maximumGeneratedSessionNameLength)}…`;
}

export function createSessionService(options: SessionServiceOptions): SessionService {
  const availabilityOf =
    options.availability ?? ((project: StoredProject) => probeProjectFolder(project.folder));
  const projectLifecycle: ProjectLifecycle = options.projectLifecycle ?? {
    run: async (_projectId, operation) => operation(),
  };

  /** Открытые сессии: harness поднят, подписка на дельты стоит. */
  const live = new Map<string, AgentSession>();
  /**
   * Записи открытых сессий. Имя живёт на записи, а не на harness
   * (docs/sessions-and-projects.md), поэтому рядом с harness держится и запись: называть сессию,
   * открывая её заново, незачем.
   */
  const records = new Map<string, PersistedAgentSession>();
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

  /**
   * Скилы, применимые к сессии. Скрытые (`disable-model-invocation`) отсюда не выбрасываются:
   * скрыты они от модели, а не от человека, и единственное место, где их отсеивают, — рендерер
   * каталога системного prompt. Выбрось их здесь — и явный запуск не нашёл бы их вовсе
   * (docs/sessions-and-projects.md).
   */
  const skillsFor = (
    contributions: ContributionRegistration[],
    agent: AgentContributionRegistration,
  ): AgentSkill[] => {
    const registrations = contributions.filter(
      (registration): registration is SkillContributionRegistration =>
        registration.kind === "skill",
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
        ...(registration.disableModelInvocation ? { disableModelInvocation: true as const } : {}),
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
    hidden: summary.hidden,
    createdAt: summary.createdAt,
  });

  /**
   * В какой полосе очереди походов к модели идёт работа этой сессии (docs/architecture.md).
   *
   * Скрытая — значит агентская: скрытые сессии заводит агент, а не человек, и других таких сегодня
   * нет. Признак берётся именно потому, что он уже есть, неизменяем с создания и совпадает с
   * нужным один в один; заводить рядом второй, который всегда равен первому, незачем.
   */
  const laneOf = (summary: AgentSessionSummary): TurnLane =>
    summary.hidden ? "agent" : "interactive";

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
      records.set(sessionId, persisted);

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
   * Очередь сообщений, ждущих освобождения сессии. Живёт в памяти демона: сообщение, которое ждёт
   * своей очереди, живёт минуты, а переживший перезапуск демона турн запустился бы в мире, которого
   * отправитель уже не видит (docs/sessions-and-projects.md).
   */
  const outbox = createMessageOutbox();

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
    const sessionId = session.summary().id;
    const collected = await options.tools.collect({ projectId, folder, sessionId });

    for (const problem of collected.problems) {
      options.logger.warn("a tool source did not answer", { problem });
    }

    const names = collected.tools.map((tool) => tool.name);
    const active = selectNames(names, agent.tools ?? emptySelection);
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

  /**
   * Действующий агент сессии вместе со вкладами её проекта. Спрашивают об этом все, кому нужно
   * определение агента, и спрашивают одинаково: агента могли выключить вместе с плагином уже после
   * того, как сессия была создана.
   */
  const agentOfSession = (
    summary: AgentSessionSummary,
  ):
    | { contributions: ContributionRegistration[]; agent: AgentContributionRegistration }
    | undefined => {
    const contributions = options.contributions.forProject(summary.projectId);
    const agent = contributions.find(
      (registration): registration is AgentContributionRegistration =>
        registration.kind === "agent" && registration.id === summary.agentId,
    );

    return agent === undefined ? undefined : { contributions, agent };
  };

  const prepareForModel = async (
    session: AgentSession,
    summary: AgentSessionSummary,
  ): Promise<{ kind: "ready" } | { kind: "missing-agent"; agentId: string }> => {
    const current = agentOfSession(summary);

    if (current === undefined) {
      return { kind: "missing-agent", agentId: summary.agentId };
    }

    await applyRuntimeDefinitions(
      session,
      summary.projectId,
      current.agent,
      summary.folder,
      current.contributions,
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
    records.delete(sessionId);
    places.delete(sessionId);
    activeTools.delete(sessionId);
    // Очередь уходит вместе с сессией: архивная и удалённая турнов не запускают, и ждущее в них
    // сообщение ждало бы вечно.
    outbox.clear(sessionId);
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
        ...(draft.hidden === true ? { hidden: true } : {}),
      });

      if ("kind" in created) {
        return { kind: "refused", reason: `the model ${model} is not available right now` };
      }

      watch(created);
      live.set(created.summary().id, created);
      const createdRecord = await options.store.open(created.summary().id);

      if (createdRecord !== undefined) {
        records.set(created.summary().id, createdRecord);
      }

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
  const imageLimits = (): ImageLimits => options.imageLimits?.() ?? defaultConfig;

  /** Отказ модели одной формулировкой: демон говорит о ней одинаково на всех путях. */
  const textOnlyModelReason = (model: string): string => `the model ${model} does not read images`;

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

    if (agentOfSession(summary) === undefined) {
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

    const place = options.queue.reserve(sessionId, laneOf(ready.session.summary()));

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

          scheduleQueueDrain(sessionId);
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

    const place = options.queue.reserve(sessionId, laneOf(session.summary()));

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
          scheduleQueueDrain(sessionId);
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

  const publishOutbox = (sessionId: string): void => {
    options.emitDelta({
      sessionId,
      turnId: places.get(sessionId)?.turnId ?? "",
      delta: { kind: "outbox", outbox: outbox.list(sessionId) },
    });
  };

  /**
   * Слить очередь после того, как сессия вернулась в простой. Через `setImmediate` по той же
   * причине, что и проверка автопорога: слот очереди походов освобождается на выходе из работы, и
   * изнутри работы его не получить.
   */
  const scheduleQueueDrain = (sessionId: string): void => {
    setImmediate(() => {
      void drainOutbox(sessionId);
    });
  };

  const drainOutbox = async (sessionId: string): Promise<void> => {
    if (closing) {
      return;
    }

    const waiting = outbox.list(sessionId);

    if (waiting.stopped !== undefined || waiting.messages.length === 0) {
      return;
    }

    // Сессия ещё занята — уходим молча: тот, кто занял слот, позовёт слив своим же выходом.
    if (options.queue.stateOf(sessionId) !== "idle") {
      return;
    }

    const head = outbox.takeHead(sessionId);

    if (head === undefined) {
      return;
    }

    publishOutbox(sessionId);

    const started = await prompt({
      sessionId,
      text: head.text,
      ...(head.images === undefined ? {} : { images: head.images }),
      ...(head.model === undefined ? {} : { model: head.model }),
      ...(head.thinkingLevel === undefined ? {} : { thinkingLevel: head.thinkingLevel }),
    });

    if (started.kind === "accepted") {
      return;
    }

    outbox.returnHead(sessionId, head);

    // Слот перехватили между проверкой и запуском — это не отказ очереди, а гонка: следующий выход
    // из работы позовёт слив снова. Останавливаем только тогда, когда сессия свободна и всё равно
    // не взяла сообщение: повторять было бы бесконечным походом в тот же отказ.
    if (options.queue.stateOf(sessionId) !== "idle") {
      publishOutbox(sessionId);

      return;
    }

    const reason = started.kind === "unknown" ? "the session is gone" : started.reason;

    outbox.halt(sessionId, reason);
    options.logger.warn("a queued message did not start a turn", { session: sessionId, reason });
    publishOutbox(sessionId);
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

  /**
   * Шаблоны промптов, применимые к сессии. Читаются на каждый спрос, а не кешируются: файлов
   * единицы и они маленькие, а кеш пришлось бы чем-то сбрасывать — вторым наблюдателем за
   * директориями рядом с уже заведённым для файловых ресурсов (docs/file-resources.md).
   *
   * Имя решает спор: проектный шаблон перекрывает пользовательский — та же лестница частности, что
   * у файловых агентов и скилов. Имя команды ядра занять нельзя вовсе.
   */
  const templatesFor = async (summary: AgentSessionSummary): Promise<PromptTemplate[]> => {
    const project = options.projects.find(summary.projectId);
    const roots: PromptTemplateRoot[] = [
      ...(options.commandsDirectory === undefined
        ? []
        : [{ path: options.commandsDirectory, scope: "user" as const }]),
      ...(project === undefined || project.archived
        ? []
        : [{ path: join(project.folder, ".sovereign", "commands"), scope: "project" as const }]),
    ];

    if (roots.length === 0) {
      return [];
    }

    const loaded = await loadPromptTemplates(roots);

    for (const diagnostic of loaded.diagnostics) {
      options.logger.warn("a prompt template could not be read", {
        path: diagnostic.path,
        reason: diagnostic.reason,
      });
    }

    const byName = new Map<string, PromptTemplate>();

    for (const template of loaded.templates) {
      if (isCoreSessionCommandName(template.name)) {
        options.logger.warn("a prompt template takes the name of a core command", {
          template: template.name,
          scope: template.scope,
        });

        continue;
      }

      // Проектный идёт вторым и потому побеждает: корни перечислены от общего к частному.
      byName.set(template.name, template);
    }

    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
  };

  const commands = async (sessionId: string): Promise<SessionCommandsOutcome> => {
    const summary = find(sessionId);

    if (summary === undefined) {
      return { kind: "unknown" };
    }

    // Архивная сессия к модели не ходит, и каталог того, что нельзя запустить, вводил бы в
    // заблуждение ровно там, где человек уже набрал `/`.
    if (summary.archived) {
      return { kind: "refused", reason: "the session is archived" };
    }

    const current = agentOfSession(summary);

    if (current === undefined) {
      return { kind: "refused", reason: `the agent ${summary.agentId} is not available` };
    }

    return {
      kind: "commands",
      commands: {
        skills: skillsFor(current.contributions, current.agent)
          .map((skill) => ({
            name: skill.name,
            description: skill.description,
            hidden: skill.disableModelInvocation === true,
          }))
          .sort((left, right) => left.name.localeCompare(right.name, "en")),
        templates: (await templatesFor(summary)).map((template) => ({
          name: template.name,
          description: template.description,
          scope: template.scope,
        })),
      },
    };
  };

  /**
   * Скил, названный человеком: тот же отбор агента, что у каталога, плюс чтение самих инструкций.
   *
   * Читает ядро, а не рантайм: реестр вкладов и отбор агента есть здесь, и только здесь видно, что
   * `starter.review` этой сессии — не тот же файл, что `starter.review` соседней.
   */
  const skillToRun = async (
    summary: AgentSessionSummary,
    name: string,
  ): Promise<{ kind: "skill"; skill: InvokedSkill } | { kind: "refused"; reason: string }> => {
    const current = agentOfSession(summary);

    if (current === undefined) {
      return { kind: "refused", reason: `the agent ${summary.agentId} is not available` };
    }

    const skill = skillsFor(current.contributions, current.agent).find(
      (candidate) => candidate.name === name,
    );

    if (skill === undefined) {
      return { kind: "refused", reason: `the skill ${name} is not available in this session` };
    }

    const size = await stat(skill.location).catch(() => undefined);

    if (size === undefined) {
      return { kind: "refused", reason: `the skill ${name} cannot be read from ${skill.location}` };
    }

    // Предел тот же, что у обхода файловых ресурсов: реестр уже прочитал этот файл по тем же
    // правилам, и второй предел рядом означал бы, что зарегистрированный скил не запускается.
    if (size.size > maximumSkillBytes) {
      return {
        kind: "refused",
        reason: `the skill ${name} is larger than ${maximumSkillBytes} bytes`,
      };
    }

    const content = await readFile(skill.location, "utf8").catch(() => undefined);

    if (content === undefined) {
      return { kind: "refused", reason: `the skill ${name} cannot be read from ${skill.location}` };
    }

    return { kind: "skill", skill: { ...skill, content } };
  };

  /**
   * Чем начинается турн: репликой человека или инструкциями названного скила. Дальше оба пути
   * совпадают до буквы — очередь, пределы, подготовка к модели и хук `turn_finished` у явного
   * скила те же, что у обычного турна.
   */
  const turnStart = async (
    session: AgentSession,
    summary: AgentSessionSummary,
    request: PromptRequest,
  ): Promise<
    | { kind: "start"; run: (turnId: string) => Promise<TurnOutcome> }
    | { kind: "refused"; reason: string }
  > => {
    if (request.template !== undefined) {
      const wanted = request.template;
      const template = (await templatesFor(summary)).find((candidate) => candidate.name === wanted);

      if (template === undefined) {
        return {
          kind: "refused",
          reason: `the prompt template ${wanted} is not available in this session`,
        };
      }

      const args = request.arguments;

      return { kind: "start", run: (turnId) => session.runPromptTemplate(template, turnId, args) };
    }

    if (request.skill !== undefined) {
      const invoked = await skillToRun(summary, request.skill);

      if (invoked.kind === "refused") {
        return invoked;
      }

      const { instructions } = request;

      return {
        kind: "start",
        run: (turnId) => session.activateSkill(invoked.skill, turnId, instructions),
      };
    }

    const { text, images } = request;

    return { kind: "start", run: (turnId) => session.prompt(text, turnId, images) };
  };

  /**
   * Влезают ли приложенные изображения в пределы и в остаток бюджета сессии.
   *
   * Записи сессии читаются только тогда, когда картинки есть: сообщение без них ничего не добавляет
   * к бюджету, и платить за чтение всего файла на каждом обычном турне незачем.
   */
  const refuseImages = async (
    sessionId: string,
    images: SessionImage[] | undefined,
  ): Promise<{ kind: "refused"; reason: string; status: 413 | 409 } | undefined> => {
    const limits = imageLimits();
    const oversized = refuseMessageImages(images, limits);

    if (oversized !== undefined) {
      return { kind: "refused", ...oversized };
    }

    const added = imagesBytes(images);

    if (added === 0) {
      return undefined;
    }

    const page = await entries(sessionId, 0);
    const stored = page === undefined ? 0 : entriesImageBytes(page.entries);
    const overBudget = refuseSessionImageBudget(stored, added, limits);

    // В журнал уезжает счёт, но не содержимое: base64 в логе бесполезен и делает журнал нечитаемым.
    options.logger.debug("images checked", {
      session: sessionId,
      images: (images ?? []).length,
      bytes: added,
      stored,
      accepted: overBudget === undefined,
    });

    return overBudget === undefined ? undefined : { kind: "refused", ...overBudget };
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

    const oversized = await refuseImages(sessionId, wanted.images);

    if (oversized !== undefined) {
      return oversized;
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

    const outcome = await opened.session.message(wanted.text, wanted.mode, wanted.images);

    if (outcome.kind === "idle") {
      return { kind: "refused", reason: "the session is idle" };
    }

    if (outcome.kind === "busy") {
      return { kind: "refused", reason: "the session is busy" };
    }

    if (outcome.kind === "text-only-model") {
      return { kind: "refused", reason: textOnlyModelReason(summary.model) };
    }

    return { kind: "accepted", accepted: { sessionId, mode: wanted.mode } };
  };

  const queued = (sessionId: string): SessionOutbox | undefined =>
    find(sessionId) === undefined ? undefined : outbox.list(sessionId);

  const enqueue = async (
    sessionId: string,
    request: SessionOutboxRequest,
  ): Promise<SessionOutboxOutcome> => {
    const summary = find(sessionId);

    if (summary === undefined) {
      return { kind: "unknown" };
    }

    if (summary.archived) {
      return { kind: "refused", reason: "the session is archived" };
    }

    const oversized = await refuseImages(sessionId, request.images);

    if (oversized !== undefined) {
      return oversized;
    }

    outbox.enqueue(sessionId, request);
    publishOutbox(sessionId);

    // Простаивающая сессия стартует тем же путём, что и освободившаяся: одна дорога у турна из
    // очереди, а не две, расходящиеся в мелочах.
    scheduleQueueDrain(sessionId);

    return { kind: "done", outbox: outbox.list(sessionId) };
  };

  const resumeQueue = (sessionId: string): SessionOutboxOutcome => {
    if (find(sessionId) === undefined) {
      return { kind: "unknown" };
    }

    outbox.resume(sessionId);
    publishOutbox(sessionId);
    scheduleQueueDrain(sessionId);

    return { kind: "done", outbox: outbox.list(sessionId) };
  };

  const steerQueued = async (
    sessionId: string,
    messageId: string,
  ): Promise<SessionOutboxOutcome> => {
    if (find(sessionId) === undefined) {
      return { kind: "unknown" };
    }

    const found = outbox.list(sessionId).messages.find((message) => message.id === messageId);

    if (found === undefined) {
      return { kind: "unknown" };
    }

    // Сообщение снимается только после того, как стиринг принят: отказ не имеет права стоить
    // человеку набранного текста.
    const steered = await message(sessionId, {
      text: found.text,
      ...(found.images === undefined ? {} : { images: found.images }),
      mode: "steer",
    });

    if (steered.kind === "unknown") {
      return { kind: "unknown" };
    }

    if (steered.kind === "refused") {
      return steered;
    }

    outbox.remove(sessionId, messageId);
    publishOutbox(sessionId);

    return { kind: "done", outbox: outbox.list(sessionId) };
  };

  const dropQueued = (sessionId: string, messageId: string): SessionOutboxOutcome => {
    if (find(sessionId) === undefined) {
      return { kind: "unknown" };
    }

    if (outbox.remove(sessionId, messageId) === undefined) {
      return { kind: "unknown" };
    }

    publishOutbox(sessionId);

    return { kind: "done", outbox: outbox.list(sessionId) };
  };

  /**
   * Безымянная сессия получает имя из первого же текстового сообщения. Только обычная реплика:
   * у скила и шаблона своего текста нет, и имя от инструкций скила было бы про скил, а не про
   * просьбу. Возвращает, названа ли сессия: по имени меняется снимок списка, и зовущий знает,
   * что список уже перечитан. Имя — обычная запись в дерево, поэтому рядом с идущим турном оно
   * безопасно, ровно как переименование (docs/sessions-and-projects.md).
   */
  const nameFromFirstMessage = async (
    sessionId: string,
    request: PromptRequest,
    record: PersistedAgentSession,
  ): Promise<boolean> => {
    if (request.text === undefined || request.text.trim() === "") {
      return false;
    }

    const summary = find(sessionId);

    if (summary === undefined || summary.name !== undefined) {
      return false;
    }

    await record.setName(sessionNameFromMessage(request.text));
    await refresh();

    return true;
  };

  const prompt = async (request: PromptRequest): Promise<PromptOutcome> => {
    const sessionId = request.sessionId;
    const ready = await readyForModel(sessionId);

    if (ready.kind !== "ready") {
      return ready;
    }

    const session = ready.session;
    const summary = session.summary();

    // Проверка до `queue.reserve`: отказ по пределу не имеет права занимать слот очереди — он не
    // пойдёт к модели вовсе, а слот тем временем не достанется тому, кто пойдёт.
    const oversized = await refuseImages(sessionId, request.images);

    if (oversized !== undefined) {
      return oversized;
    }

    // По той же причине здесь же решается, чем турн начнётся: разрешение названного скила и чтение
    // его инструкций — работа, которая может кончиться отказом.
    const start = await turnStart(session, summary, request);

    if (start.kind === "refused") {
      return start;
    }

    const project = options.projects.find(summary.projectId);

    if (project === undefined || project.archived) {
      return {
        kind: "refused",
        reason: project?.archived === true ? "the project is archived" : "the project is gone",
      };
    }

    const place = options.queue.reserve(sessionId, laneOf(summary));

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
          // Безымянная сессия получает имя из первого текстового сообщения. Со стартом турна, а
          // не с принятием: запись в дерево стоит файлового I/O, а принятие обязано оставаться
          // быстрым (docs/sessions-and-projects.md). Запись у живой сессии есть всегда — создание
          // или открытие положили её в `records`.
          const record = records.get(sessionId);

          if (record !== undefined) {
            await nameFromFirstMessage(sessionId, request, record);
          }

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

          const outcome = await start.run(turnId);

          if (outcome.kind === "failed") {
            options.logger.warn("a turn failed", { session: sessionId, reason: outcome.reason });

            // Упавший турн останавливает очередь: остаток уехал бы в тот же тупик, только за
            // деньги владельца. Прерванный руками турн возвращает `done` — очередь идёт дальше,
            // потому что прервали именно этот турн, а не работу вообще.
            outbox.halt(sessionId, outcome.reason);
            publishOutbox(sessionId);
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
          scheduleQueueDrain(sessionId);
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
    const stopped = session === undefined ? undefined : await session.abort();
    const interrupted = dropped || stopped?.aborted === true;

    // Прерывание чистит очереди рантайма, и вклиненное, которого модель так и не увидела, иначе
    // пропало бы молча. Оно встаёт в голову: написано раньше всего, что успело встать в очередь,
    // пока турн шёл. Обратный порядок — потому что каждое следующее оттесняет предыдущее.
    for (const cleared of [...(stopped?.cleared ?? [])].reverse()) {
      outbox.enqueueHead(sessionId, cleared);
    }

    if (stopped !== undefined && stopped.cleared.length > 0) {
      publishOutbox(sessionId);
    }

    if (interrupted) {
      announce();
    }

    // Снятый с очереди турн не выполняется вовсе, поэтому его `finally` слив не позовёт: без этого
    // вызова «прервал — пошло следующее» не работало бы ровно там, где прерывать быстрее всего.
    if (dropped) {
      scheduleQueueDrain(sessionId);
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
    commands,
    abort,
    fork,
    update,
    remove,
    message,
    queued,
    enqueue,
    resumeQueue,
    steerQueued,
    dropQueued,
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
        // Свой предел тела: общий рассчитан на короткий json ядра, а сюда приезжает base64
        // изображений. Считается из предела сообщения, чтобы два числа не разошлись.
        bodyLimitBytes: () => bodyLimitFor(imageLimits()),
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
            respondWithError(response, accepted.status ?? 409, accepted.reason);

            return;
          }

          respondWithJson(response, 200, accepted.accepted);
        },
      },
      {
        method: "GET",
        path: sessionQueuePathPattern,
        handle: ({ response, parameters }) => {
          // Снимок, а не только дельты: переподключившийся клиент про очередь иначе не узнал бы
          // ничего до следующего её изменения (docs/web-api.md).
          const waiting = queued(parameters["sessionId"] ?? "");

          if (waiting === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          respondWithJson(response, 200, waiting);
        },
      },
      {
        method: "POST",
        path: sessionQueuePathPattern,
        // Свой предел тела по той же причине, что у сообщений: сюда приезжает base64 изображений.
        bodyLimitBytes: () => bodyLimitFor(imageLimits()),
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionOutboxRequest(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          respondWithOutbox(response, await enqueue(parameters["sessionId"] ?? "", parsed.value));
        },
      },
      {
        method: "PUT",
        path: sessionQueuePathPattern,
        handle: ({ response, parameters, body }) => {
          const parsed = parseSessionOutboxUpdate(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          respondWithOutbox(response, resumeQueue(parameters["sessionId"] ?? ""));
        },
      },
      {
        method: "PUT",
        path: sessionQueuedMessagePathPattern,
        handle: async ({ response, parameters, body }) => {
          const parsed = parseSessionOutboxAction(body);

          if (parsed.kind === "rejected") {
            respondWithError(response, 400, parsed.diagnostics.join("; "));

            return;
          }

          respondWithOutbox(
            response,
            await steerQueued(parameters["sessionId"] ?? "", parameters["messageId"] ?? ""),
          );
        },
      },
      {
        method: "DELETE",
        path: sessionQueuedMessagePathPattern,
        handle: ({ response, parameters }) => {
          respondWithOutbox(
            response,
            dropQueued(parameters["sessionId"] ?? "", parameters["messageId"] ?? ""),
          );
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
        method: "GET",
        path: sessionCommandsPathPattern,
        handle: async ({ response, parameters }) => {
          const catalogue = await commands(parameters["sessionId"] ?? "");

          if (catalogue.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (catalogue.kind === "refused") {
            respondWithError(response, 409, catalogue.reason);

            return;
          }

          respondWithJson(response, 200, catalogue.commands);
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
        // Свой предел тела: общий рассчитан на короткий json ядра, а сюда приезжает base64
        // изображений. Считается из предела сообщения, чтобы два числа не разошлись.
        bodyLimitBytes: () => bodyLimitFor(imageLimits()),
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
            respondWithError(response, started.status ?? 409, started.reason);

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
