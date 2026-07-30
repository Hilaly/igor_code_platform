/**
 * Сессия агента поверх harness Pi (docs/sessions-and-projects.md).
 *
 * Наружу отсюда уезжают только типы протокола: записи дерева, дельты и состояния — наши, а не Pi
 * (docs/architecture.md). Инструменты — исключение: они уезжают в демон непрозрачной ручкой, потому
 * что собирает набор ядро (`tools_collect`), а понимать его содержимое ему незачем.
 *
 * Хранилище — JSONL-реализация самого Pi, направленная в директорию данных. Своей не пишем: формат
 * тот же, форк и компакция следующих срезов достаются даром, а дозапись в конец не нуждается в
 * атомарной перезаписи файла, ради которой существует `writeFileAtomically` в демоне.
 */

import { mkdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  AgentHarness,
  AgentHarnessError,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  JsonlSessionRepo,
  SessionError,
  type AgentHarnessEvent,
  type AgentHarnessTool,
  type ExecutionToolContext,
  type JsonlSessionMetadata,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { MutableModels } from "@earendil-works/pi-ai";
import {
  isThinkingLevel,
  modelReference,
  parseModelReference,
  type SessionContentBlock,
  type SessionDelta,
  type SessionEntry,
  type SessionMessageMode,
  type SessionPhase,
  type SessionQueues,
  type SessionStats,
  type ThinkingLevel,
} from "@sovereign/protocol";

/** Инструмент глазами ядра: имя, которым его видит модель, и непрозрачная ручка на реализацию. */
export type AgentTool = {
  name: string;
  tool: unknown;
};

/** Что известно о сессии, не поднимая harness. */
export type AgentSessionSummary = {
  id: string;
  projectId: string;
  agentId: string;
  folder: string;
  /** Ключ сравнения папок, тот же, что у проектов: принадлежность выражена папкой, а не ключом. */
  folderKey: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  /** Имя, данное человеком. Безымянная сессия — норма. */
  name?: string;
  /** Признак архива — корень, в котором лежит файл, а не запись внутри него. */
  archived: boolean;
  createdAt: string;
};

/** Всё, что сессии нужно знать про агента. Собирает это ядро из реестра вкладов. */
export type AgentDefinition = {
  id: string;
  instructions: string;
};

export type AgentSession = {
  summary: () => AgentSessionSummary;
  /** Состояние по версии рантайма. `queued` отсюда не приходит: очередь — забота ядра. */
  phase: () => SessionPhase;
  /** Отказ `busy` приезжает исходом, а не исключением: занятость — обычное состояние, а не сбой. */
  prompt: (text: string, turnId: string) => Promise<TurnOutcome>;
  /** `false` — прерывать было нечего. */
  abort: () => Promise<boolean>;
  /** Проверить текущую модель по живому каталогу, не меняя и не записывая её. */
  validateModel: () => ModelOutcome;
  setModel: (reference: string) => Promise<ModelOutcome>;
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>;
  setTools: (tools: AgentTool[], activeToolNames: string[]) => Promise<void>;
  /**
   * Сообщение, которое не запускает турн. Куда оно встанет, решает режим; отказ приезжает исходом,
   * а не исключением, потому что у режимов разные требования к занятости сессии.
   */
  message: (text: string, mode: SessionMessageMode) => Promise<MessageOutcome>;
  /** Что сейчас ждёт в очередях. Снимок для клиента, который подключился посреди турна. */
  queues: () => SessionQueues;
  /** Записи дерева с курсором. Курсор считается в записях рантайма, а не в наших. */
  entries: (after?: number) => Promise<{ entries: SessionEntry[]; seen: number }>;
  subscribe: (listener: (delta: SessionDelta) => void) => () => void;
  /** Освободить среду исполнения. Зовётся, когда сессию выгружают из памяти. */
  close: () => Promise<void>;
};

/** Запись сессии на диске. Читать её можно без действующих агента и модели. */
export type PersistedAgentSession = {
  summary: () => AgentSessionSummary;
  /** Записи дерева с курсором. Курсор считается в записях рантайма, а не в наших. */
  entries: (after?: number) => Promise<{ entries: SessionEntry[]; seen: number }>;
  /**
   * Поднять harness с текущими зависимостями. Запись остаётся читаемой при отказе. Повторный вызов
   * отдаёт тот же harness: второй писал бы в тот же файл от своего представления о листе дерева.
   */
  activate: (agent: AgentDefinition) => AgentSession | { kind: "unknown-model" };
  /**
   * Назвать сессию. Живёт на записи, а не на harness: переименовать надо уметь и ту сессию, чью
   * модель или чей плагин с агентом убрали, — иначе имя нельзя дать ровно там, где оно нужнее.
   */
  setName: (name: string) => Promise<void>;
  /** Счёт токенов и денег по всему файлу, включая брошенные ветки. */
  stats: () => Promise<AgentSessionStats>;
  /**
   * Записать в дерево, что сессия лишилась инструмента или модели и доигрывает без них.
   *
   * Запись вида `custom`, а не сообщение: про исчезнувший инструмент рантайм уже сказал модели
   * текстом результата вызова, и второе сообщение в контексте её запутает; про недоступную модель
   * говорить модели бессмысленно — турна нет. Это след для человека, а не для агента.
   */
  noteDegradation: (kind: "tool" | "model", name: string) => Promise<void>;
  /** Остановить поднятый harness, если он был. Сама запись остаётся на диске. */
  close: () => Promise<void>;
};

export type TurnOutcome = { kind: "done" } | { kind: "busy" } | { kind: "failed"; reason: string };

export type ModelOutcome = { kind: "applied" } | { kind: "unknown-model" };

/**
 * Исход постановки сообщения в очередь. `idle` и `busy` — не сбой, а несовпадение с требованием
 * режима: стиринг и догоняющее требуют идущего турна, дозапись — простоя.
 */
export type MessageOutcome = { kind: "queued" } | { kind: "idle" } | { kind: "busy" };

export type AgentSessionStats = Omit<SessionStats, "sessionId">;

/**
 * Тип записи об утрате опоры. С неймспейсом платформы, потому что `custom` — общая точка, куда
 * кладут своё и приложение, и плагины: без неймспейса две записи столкнулись бы именами.
 */
export const degradationEntryType = "sovereign.degraded";

/** Исход переноса между корнями. Сессия уже там, куда её просят, — успех, а не отказ. */
export type ArchiveOutcome = { kind: "moved" } | { kind: "unknown-session" };

/** Что вышло из форка. Отказ рантайма приезжает исходом: указать не ту запись — обычная ошибка. */
export type ForkOutcome =
  | { kind: "forked"; session: PersistedAgentSession }
  | { kind: "unknown-session" }
  | { kind: "refused"; reason: string };

export type CreateAgentSessionInput = {
  projectId: string;
  agentId: string;
  folder: string;
  folderKey: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  agent: AgentDefinition;
};

export type AgentSessionStore = {
  create: (input: CreateAgentSessionInput) => Promise<AgentSession | { kind: "unknown-model" }>;
  /**
   * `undefined` — такой сессии нет. Открытие читает JSONL, но не поднимает harness.
   *
   * Повторный вызов отдаёт тот же экземпляр: у файла сессии один владелец на процесс.
   */
  open: (id: string) => Promise<PersistedAgentSession | undefined>;
  list: () => Promise<AgentSessionSummary[]>;
  /**
   * Новая сессия из куска старой. Остаётся в том же проекте и в той же папке: `metadata` источника
   * наследуется целиком, и форк «в другой проект» означал бы подменить её вручную.
   */
  fork: (sourceId: string, options?: ForkRequest) => Promise<ForkOutcome>;
  /** Стереть файл сессии. `false` — стирать было нечего. */
  remove: (id: string) => Promise<boolean>;
  /**
   * Убрать сессию с глаз, не теряя её: файл переезжает в архивный корень. Требует, чтобы файл
   * никто не дописывал, поэтому harness сессии останавливается — простой обеспечивает вызывающий.
   */
  archive: (id: string) => Promise<ArchiveOutcome>;
  /** Вернуть сессию из архива тем же переносом в обратную сторону. */
  restore: (id: string) => Promise<ArchiveOutcome>;
  /** Файлы, которые прочитать не вышло. Одна битая сессия не отменяет остальные. */
  problems: () => string[];
  /** Выгрузить сессию из памяти: harness останавливается, следующий `open` читает файл заново. */
  close: (id: string) => Promise<void>;
};

/**
 * Где резать при форке. `before` оставляет всё до записи и работает **только по сообщению
 * человека**: единственный смысл, в котором отрезать ответ модели вместе с вопросом осмысленно, —
 * «переспросить иначе». `at` берёт путь до любой записи включительно.
 */
export type ForkRequest = {
  entryId?: string;
  position?: "before" | "at";
};

export type CreateAgentSessionStoreOptions = {
  /**
   * Коллекция моделей рантайма — та же, которой пользуется каталог провайдеров. Тип из Pi, поэтому
   * за пределами пакета этим значением можно только владеть, но не пользоваться.
   */
  models: MutableModels;
  /** Корень записей сессий внутри директории данных (docs/data-directory.md). */
  directory: string;
  /**
   * Корень архивных записей — сосед первого, а не папка внутри него: архивация переносит файл
   * между корнями, а вложенная папка притворилась бы папкой рабочей директории при обходе.
   */
  archivedDirectory: string;
};

/**
 * Четыре инструмента поставки: они приходят из рантайма, а не из плагинов
 * (docs/agent-runtime-contract.md).
 *
 * Папки среди аргументов нет намеренно: папку задаёт среда исполнения сессии, одним значением на
 * весь турн, а не флагом у каждого инструмента.
 */
export function createCoreTools(): AgentTool[] {
  return [
    { name: "bash", tool: createBashTool() },
    { name: "read", tool: createReadTool() },
    { name: "write", tool: createWriteTool() },
    { name: "edit", tool: createEditTool() },
  ];
}

export function createAgentSessionStore(
  options: CreateAgentSessionStoreOptions,
): AgentSessionStore {
  const storage = new NodeExecutionEnv({ cwd: options.directory });
  // Два корня — два репозитория рантайма со своими `list`, `open` и `delete`. Действующий корень
  // про архивный не знает вовсе, поэтому архивная сессия не может случайно попасть в его список.
  const repo = new JsonlSessionRepo({ fs: storage, sessionsRoot: options.directory });
  const archivedRepo = new JsonlSessionRepo({
    fs: storage,
    sessionsRoot: options.archivedDirectory,
  });
  /**
   * Один владелец на файл сессии. Экземпляр `Session` держит своё дерево записей и свой лист в
   * памяти, а дозапись идёт от этого листа: два экземпляра на один файл разошлись бы ветками при
   * первой же записи мимо второго — и разошлись бы молча, испортив цепочку `parentId`.
   */
  const owned = new Map<string, PersistedAgentSession>();
  let problems: string[] = [];

  /** Запись файла сессии вместе с тем, в каком корне она лежит. Корень и есть признак архива. */
  type Located = { metadata: JsonlSessionMetadata; archived: boolean };

  const listMetadata = async (scanProblems: string[]): Promise<Located[]> => {
    const roots: [JsonlSessionRepo, boolean][] = [
      [repo, false],
      [archivedRepo, true],
    ];
    const found: Located[] = [];

    for (const [root, archived] of roots) {
      try {
        for (const metadata of await root.list()) {
          found.push({ metadata, archived });
        }
      } catch (cause) {
        // Нечитаемый корень — не отказ поверхности: сессий просто не видно, и об этом надо сказать.
        const which = archived ? "archived sessions" : "sessions";

        scanProblems.push(`the ${which} could not be listed: ${describe(cause)}`);
      }
    }

    return found;
  };

  const locate = async (id: string): Promise<Located | undefined> => {
    const scanProblems: string[] = [];
    const found = (await listMetadata(scanProblems)).find(
      (candidate) => candidate.metadata.id === id,
    );

    problems = scanProblems;

    return found;
  };

  const repoOf = (located: Located): JsonlSessionRepo => (located.archived ? archivedRepo : repo);

  /** Забыть сессию и остановить её harness. После этого файл можно двигать и стирать. */
  const release = async (id: string): Promise<void> => {
    const known = owned.get(id);

    owned.delete(id);
    await known?.close();
  };

  /**
   * Архивация и разархив — перенос файла между корнями. Папка рабочей директории воссоздаётся с тем
   * же именем: как рантайм кодирует путь в имя папки — его дело, и переизобретать эту кодировку
   * незачем, достаточно перенести имя дословно.
   */
  const move = async (id: string, archived: boolean): Promise<ArchiveOutcome> => {
    const located = await locate(id);

    if (located === undefined) {
      return { kind: "unknown-session" };
    }

    if (located.archived === archived) {
      return { kind: "moved" };
    }

    const source = located.metadata.path;
    const target = join(
      archived ? options.archivedDirectory : options.directory,
      basename(dirname(source)),
      basename(source),
    );

    // Сначала отпустить файл, потом двигать: у открытой сессии в памяти лежит старый путь, и
    // следующая дозапись ушла бы по нему — то есть мимо перенесённого файла.
    await release(id);
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);

    return { kind: "moved" };
  };

  const own = (session: PiSession, summary: AgentSessionSummary): PersistedAgentSession => {
    const known = owned.get(summary.id);

    if (known !== undefined) {
      return known;
    }

    const persisted = persistedSession(session, options.models, summary);

    owned.set(summary.id, persisted);

    return persisted;
  };

  return {
    create: async (input) => {
      const model = resolveModel(options.models, input.model);

      if (model === undefined) {
        return { kind: "unknown-model" };
      }

      const session = await repo.create({
        cwd: input.folder,
        metadata: {
          projectId: input.projectId,
          agentId: input.agentId,
          folderKey: input.folderKey,
        },
      });

      // Модель и уровень ризонинга пишутся записями дерева, а не в заголовок: заголовок не
      // переписывается никогда, а меняются они на живой сессии.
      await session.appendModelChange(model.provider, model.id);
      await session.appendThinkingLevelChange(input.thinkingLevel);

      return own(session, await summaryOf(session, false)).activate(input.agent);
    },
    open: async (id) => {
      const known = owned.get(id);

      if (known !== undefined) {
        return known;
      }

      const located = await locate(id);

      if (located === undefined) {
        return undefined;
      }

      const session = await repoOf(located).open(located.metadata);

      return own(session, await summaryOf(session, located.archived));
    },
    list: async () => {
      const scanProblems: string[] = [];
      const summaries = await Promise.all(
        (await listMetadata(scanProblems)).map(async (located) => {
          try {
            return await summaryOfMetadata(repoOf(located), located);
          } catch (cause) {
            scanProblems.push(
              `the session ${located.metadata.id} could not be read: ${describe(cause)}`,
            );

            return undefined;
          }
        }),
      );

      problems = scanProblems;

      return summaries.filter((summary): summary is AgentSessionSummary => summary !== undefined);
    },
    fork: async (sourceId, request = {}) => {
      const located = await locate(sourceId);

      if (located === undefined) {
        return { kind: "unknown-session" };
      }

      let forked: PiSession;

      try {
        // Форк всегда рождается действующим: продолжать работу в архиве бессмысленно.
        forked = await repo.fork(located.metadata, { cwd: located.metadata.cwd, ...request });
      } catch (cause) {
        // Не та запись — обычная ошибка вызывающего, а не сбой хранилища: она приезжает исходом.
        // Всё прочее (не пишется файл, не читается дерево) уезжает наверх исключением.
        if (cause instanceof SessionError && cause.code === "invalid_fork_target") {
          return { kind: "refused", reason: cause.message };
        }

        throw cause;
      }

      return { kind: "forked", session: own(forked, await summaryOf(forked, false)) };
    },
    remove: async (id) => {
      const located = await locate(id);

      if (located === undefined) {
        return false;
      }

      await release(id);
      await repoOf(located).delete(located.metadata);

      return true;
    },
    archive: (id) => move(id, true),
    restore: (id) => move(id, false),
    problems: () => [...problems],
    close: async (id) => {
      const known = owned.get(id);

      if (known === undefined) {
        return;
      }

      owned.delete(id);
      await known.close();
    },
  };
}

type PiSession = Awaited<ReturnType<JsonlSessionRepo["create"]>>;

async function summaryOfMetadata(
  repo: JsonlSessionRepo,
  located: { metadata: JsonlSessionMetadata; archived: boolean },
): Promise<AgentSessionSummary> {
  return summaryOf(await repo.open(located.metadata), located.archived);
}

/**
 * Текущие модель, уровень ризонинга и имя выводятся из записей дерева, а не хранятся в заголовке:
 * их меняют на живой сессии, а заголовок дописанного файла не переписывается.
 */
async function summaryOf(session: PiSession, archived: boolean): Promise<AgentSessionSummary> {
  const metadata = await session.getMetadata();
  const fields = (metadata.metadata ?? {}) as Record<string, unknown>;
  const entries = await session.getEntries();

  let model = "";
  let thinkingLevel: ThinkingLevel = "off";

  for (const entry of entries) {
    if (entry.type === "model_change") {
      model = modelReference(entry.provider, entry.modelId);
    }

    if (entry.type === "thinking_level_change" && isThinkingLevel(entry.thinkingLevel)) {
      thinkingLevel = entry.thinkingLevel;
    }
  }

  const name = await session.getSessionName();

  return {
    id: metadata.id,
    projectId: asText(fields["projectId"]),
    agentId: asText(fields["agentId"]),
    folder: metadata.cwd,
    folderKey: asText(fields["folderKey"]),
    model,
    thinkingLevel,
    ...(name === undefined ? {} : { name }),
    archived,
    createdAt: metadata.createdAt,
  };
}

function liveSession(
  session: PiSession,
  models: MutableModels,
  agent: AgentDefinition,
  summary: AgentSessionSummary,
  onClosed: () => void,
): AgentSession | { kind: "unknown-model" } {
  const model = resolveModel(models, summary.model);

  if (model === undefined) {
    return { kind: "unknown-model" };
  }

  const environment = new NodeExecutionEnv({ cwd: summary.folder });
  const harness = new AgentHarness<ExecutionToolContext>({
    session,
    models,
    model,
    thinkingLevel: summary.thinkingLevel,
    tools: [],
    toolContext: { env: environment },
    systemPrompt: agent.instructions,
  });

  const listeners = new Set<(delta: SessionDelta) => void>();
  const publish = (delta: SessionDelta): void => {
    for (const listener of [...listeners]) {
      listener(delta);
    }
  };

  let phase: SessionPhase = "idle";
  let current: { turnId: string; aborted: boolean; messages: number } | undefined;

  const setPhase = (next: SessionPhase): void => {
    if (phase === next) {
      return;
    }

    phase = next;
    publish({ kind: "phase", phase: next });
  };

  /**
   * Очереди рантайм наружу не отдаёт — только сообщает о смене событием, поэтому последнее
   * состояние приходится помнить: клиент, подключившийся посреди турна, спросит снимок.
   */
  let queues: SessionQueues = { steer: [], followUp: [], nextTurn: [] };

  harness.subscribe((event) => {
    if (event.type === "queue_update") {
      queues = {
        steer: event.steer.map(queuedText),
        followUp: event.followUp.map(queuedText),
        nextTurn: event.nextTurn.map(queuedText),
      };
      publish({ kind: "queues", queues });

      return;
    }

    translate(event, current, publish);
  });

  return {
    summary: () => ({ ...summary }),
    phase: () => phase,
    queues: () => ({
      steer: [...queues.steer],
      followUp: [...queues.followUp],
      nextTurn: [...queues.nextTurn],
    }),
    message: async (text, mode) => {
      // Требования к занятости у режимов разные, и проверяются они здесь, а не в рантайме: у
      // рантайма это исключение `invalid_state`, а у нас — обычный исход, который маршрут переводит
      // в `409` с внятной причиной.
      if ((mode === "steer" || mode === "follow-up") && phase === "idle") {
        return { kind: "idle" };
      }

      if (mode === "append" && phase !== "idle") {
        return { kind: "busy" };
      }

      if (mode === "steer") {
        await harness.steer(text);
      } else if (mode === "follow-up") {
        await harness.followUp(text);
      } else if (mode === "next-turn") {
        await harness.nextTurn(text);
      } else {
        await harness.appendMessage({
          role: "user",
          content: [{ type: "text", text }],
          timestamp: Date.now(),
        });
      }

      return { kind: "queued" };
    },
    prompt: async (text, turnId) => {
      if (phase !== "idle") {
        return { kind: "busy" };
      }

      current = { turnId, aborted: false, messages: 0 };
      setPhase("turn");

      try {
        const answer = await harness.prompt(text);

        if (answer.stopReason === "error") {
          publish({ kind: "turn-failed", reason: answer.errorMessage ?? "the turn failed" });

          return { kind: "failed", reason: answer.errorMessage ?? "the turn failed" };
        }

        publish(current.aborted ? { kind: "turn-aborted" } : { kind: "turn-end" });

        return { kind: "done" };
      } catch (cause) {
        if (cause instanceof AgentHarnessError && cause.code === "busy") {
          return { kind: "busy" };
        }

        publish({ kind: "turn-failed", reason: describe(cause) });

        return { kind: "failed", reason: describe(cause) };
      } finally {
        current = undefined;
        setPhase("idle");
      }
    },
    abort: async () => {
      if (current === undefined) {
        return false;
      }

      current.aborted = true;
      await harness.abort();

      return true;
    },
    validateModel: () =>
      resolveModel(models, summary.model) === undefined
        ? { kind: "unknown-model" }
        : { kind: "applied" },
    setModel: async (reference) => {
      const next = resolveModel(models, reference);

      if (next === undefined) {
        return { kind: "unknown-model" };
      }

      await harness.setModel(next);
      summary.model = reference;

      return { kind: "applied" };
    },
    setThinkingLevel: async (level) => {
      await harness.setThinkingLevel(level);
      summary.thinkingLevel = level;
    },
    setTools: async (tools, activeToolNames) => {
      await harness.setTools(
        tools.map((entry) => entry.tool as AgentHarnessTool<ExecutionToolContext>),
        activeToolNames,
      );
    },
    entries: async (after = 0) => {
      return entriesOf(session, after);
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    close: async () => {
      onClosed();
      await environment.cleanup();
    },
  };
}

function persistedSession(
  session: PiSession,
  models: MutableModels,
  summary: AgentSessionSummary,
): PersistedAgentSession {
  let live: AgentSession | undefined;

  return {
    summary: () => ({ ...summary }),
    entries: (after = 0) => entriesOf(session, after),
    activate: (agent) => {
      if (live !== undefined) {
        return live;
      }

      const started = liveSession(session, models, agent, summary, () => {
        live = undefined;
      });

      if (!("kind" in started)) {
        live = started;
      }

      return started;
    },
    setName: async (name) => {
      await session.appendSessionName(name);

      // Сводка общая с живой сессией по ссылке, поэтому переименование видно и через harness.
      summary.name = await session.getSessionName();
    },
    stats: async () => {
      const { messageCount, cachedTokens, uncachedTokens, totalTokens, costTotal } =
        await session.getSessionStats();

      return { messageCount, cachedTokens, uncachedTokens, totalTokens, costTotal };
    },
    noteDegradation: async (kind, name) => {
      await session.appendCustomEntry(degradationEntryType, { kind, name });
    },
    close: async () => {
      await live?.close();
    },
  };
}

async function entriesOf(
  session: PiSession,
  after: number,
): Promise<{ entries: SessionEntry[]; seen: number }> {
  const found = await session.getEntries({ afterEntrySeq: after });

  return { entries: found.flatMap(describeEntry), seen: after + found.length };
}

/**
 * Перевод событий цикла агента в дельты. Событий у Pi больше, чем дельт: сюда попадает только то,
 * что видно человеку в ленте (docs/agent-runtime-contract.md).
 */
function translate(
  event: AgentHarnessEvent,
  current: { turnId: string; messages: number } | undefined,
  publish: (delta: SessionDelta) => void,
): void {
  if (current === undefined) {
    return;
  }

  if (event.type === "message_start") {
    const role = event.message.role;

    if (role !== "user" && role !== "assistant") {
      return;
    }

    current.messages += 1;

    const messageId = `${current.turnId}:${String(current.messages)}`;

    publish({ kind: "message-start", messageId, role: role === "user" ? "user" : "agent" });

    // Сообщение человека не стримится: оно приезжает целиком. Дельта у него одна, чтобы вью не
    // заводило второй путь отрисовки на ту же ленту.
    if (role === "user") {
      publish({
        kind: "message-delta",
        messageId,
        channel: "text",
        text: textOf(event.message.content),
      });
    }

    return;
  }

  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;
    const messageId = `${current.turnId}:${String(current.messages)}`;

    if (delta.type === "text_delta") {
      publish({ kind: "message-delta", messageId, channel: "text", text: delta.delta });
    }

    if (delta.type === "thinking_delta") {
      publish({ kind: "message-delta", messageId, channel: "reasoning", text: delta.delta });
    }

    return;
  }

  if (event.type === "message_end") {
    const role = event.message.role;

    if (role === "user" || role === "assistant") {
      publish({ kind: "message-end", messageId: `${current.turnId}:${String(current.messages)}` });
    }

    return;
  }

  if (event.type === "tool_execution_start") {
    publish({
      kind: "tool-start",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.args,
    });

    return;
  }

  if (event.type === "tool_execution_end") {
    publish({ kind: "tool-end", toolCallId: event.toolCallId, failed: event.isError });
  }
}

/**
 * Перевод записи дерева. Незнакомая запись приезжает как `other` со своим типом рантайма: молчаливая
 * потеря записи сделала бы ленту неполной без всякого следа.
 */
function describeEntry(entry: SessionTreeEntry): SessionEntry[] {
  const common = {
    id: entry.id,
    ...(entry.parentId === null ? {} : { parentId: entry.parentId }),
    time: entry.timestamp,
  };

  if (entry.type === "model_change") {
    return [
      { ...common, kind: "model-change", model: modelReference(entry.provider, entry.modelId) },
    ];
  }

  if (entry.type === "thinking_level_change") {
    return isThinkingLevel(entry.thinkingLevel)
      ? [{ ...common, kind: "thinking-level-change", thinkingLevel: entry.thinkingLevel }]
      : [{ ...common, kind: "other", type: entry.type }];
  }

  if (entry.type === "active_tools_change") {
    return [{ ...common, kind: "tools-change", toolNames: [...entry.activeToolNames] }];
  }

  if (entry.type !== "message") {
    return [{ ...common, kind: "other", type: entry.type }];
  }

  const message = entry.message;

  if (message.role === "user") {
    return [
      {
        ...common,
        kind: "message",
        role: "user",
        content: [{ kind: "text", text: textOf(message.content) }],
      },
    ];
  }

  if (message.role === "assistant") {
    return [{ ...common, kind: "message", role: "agent", content: blocksOf(message.content) }];
  }

  if (message.role === "toolResult") {
    return [
      {
        ...common,
        kind: "tool-result",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        text: textOf(message.content),
        failed: message.isError,
      },
    ];
  }

  // Сообщение вида, которого этот срез не переводит: исполнение bash, суммаризация, своё сообщение
  // плагина. Роль уезжает как тип — по ней видно, чего именно недостаёт.
  return [{ ...common, kind: "other", type: message.role }];
}

function blocksOf(content: readonly unknown[]): SessionContentBlock[] {
  const blocks: SessionContentBlock[] = [];

  for (const piece of content) {
    const part = piece as { type?: string; text?: string; thinking?: string };

    if (part.type === "text" && typeof part.text === "string") {
      blocks.push({ kind: "text", text: part.text });
    }

    if (part.type === "thinking") {
      blocks.push({ kind: "reasoning", text: String(part.thinking ?? "") });
    }

    if (part.type === "toolCall") {
      const call = piece as { id: string; name: string; arguments: unknown };

      blocks.push({
        kind: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        input: call.arguments,
      });
    }
  }

  return blocks;
}

/**
 * Текст сообщения, ждущего в очереди. В очередях лежат сообщения человека, но тип рантайма шире —
 * в нём есть и сообщения без содержимого вовсе, и пустая строка для них честнее выдумки.
 */
function queuedText(message: object): string {
  return "content" in message ? textOf(message.content) : "";
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((piece) => {
      const part = piece as { type?: string; text?: string };

      return part.type === "text" ? (part.text ?? "") : "";
    })
    .join("");
}

function resolveModel(models: MutableModels, reference: string) {
  const parsed = parseModelReference(reference);

  return parsed === undefined ? undefined : models.getModel(parsed.providerId, parsed.modelId);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
