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
  compact as generateCompaction,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  estimateContextTokens,
  JsonlSessionRepo,
  parseCommandArgs,
  prepareCompaction,
  SessionError,
  type AgentHarnessEvent,
  type AgentHarnessEventResultMap,
  type AgentHarnessTool,
  type ExecutionToolContext,
  type JsonlSessionMetadata,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { AssistantMessage, MutableModels, Usage } from "@earendil-works/pi-ai";
import {
  isThinkingLevel,
  modelReference,
  parseModelReference,
  isSessionImageMimeType,
  type SessionContentBlock,
  type SessionDelta,
  type SessionEntry,
  type SessionImage,
  type SessionMessageMode,
  type SessionPhase,
  type SessionQueuedMessage,
  type SessionQueues,
  type SessionStats,
  type ThinkingLevel,
} from "@sovereign/protocol";

import {
  runtimeHookKinds,
  type RuntimeHookName,
  type RuntimeHookRefusal,
  type RuntimeHookSeam,
} from "./hook-events.ts";
import { renderRuntimeContext } from "./agent-data.ts";
import { renderSkillCatalogue, type AgentSkill, type InvokedSkill } from "./skills.ts";

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
  directory?: string;
};

export type AgentSession = {
  summary: () => AgentSessionSummary;
  /** Состояние по версии рантайма. `queued` отсюда не приходит: очередь — забота ядра. */
  phase: () => SessionPhase;
  /** Отказ `busy` приезжает исходом, а не исключением: занятость — обычное состояние, а не сбой. */
  prompt: (text: string, turnId: string, images?: SessionImage[]) => Promise<TurnOutcome>;
  /**
   * Турн, начатый скилом, который человек назвал сам. Обычный турн, а не второй путь мимо очереди:
   * отличается только тем, что первым сообщением уезжают инструкции скила, а не реплика.
   *
   * Скил приезжает с уже прочитанным текстом: искать и читать `SKILL.md` — работа ядра, у которого
   * есть реестр вкладов и отбор агента, а у рантайма нет ни того, ни другого.
   */
  activateSkill: (
    skill: InvokedSkill,
    turnId: string,
    instructions?: string,
  ) => Promise<TurnOutcome>;
  /**
   * Турн, начатый шаблоном промпта. Аргументы приезжают строкой, как их набрал человек: правила
   * кавычек принадлежат Pi, который их и подставляет, и второй разбор рядом с ним разошёлся бы.
   */
  runPromptTemplate: (
    template: { name: string; description: string; content: string },
    turnId: string,
    args?: string,
  ) => Promise<TurnOutcome>;
  abort: () => Promise<AbortOutcome>;
  /** Проверить текущую модель по живому каталогу, не меняя и не записывая её. */
  validateModel: () => ModelOutcome;
  setModel: (reference: string) => Promise<ModelOutcome>;
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>;
  setTools: (tools: AgentTool[], activeToolNames: string[]) => Promise<void>;
  /** Целиком заменить инструкции, которые попадут в следующую операцию модели. */
  setInstructions: (instructions: string) => void;
  /** Заменить папку данных агента, которая попадёт в следующую операцию модели. */
  setAgentDirectory: (directory?: string) => void;
  /** Целиком заменить каталог скилов, который попадёт в следующую операцию модели. */
  setSkills: (skills: AgentSkill[]) => void;
  /**
   * Сообщение, которое не запускает турн. Куда оно встанет, решает режим; отказ приезжает исходом,
   * а не исключением, потому что у режимов разные требования к занятости сессии.
   */
  message: (
    text: string,
    mode: SessionMessageMode,
    images?: SessionImage[],
  ) => Promise<MessageOutcome>;
  /** Что сейчас ждёт в очередях. Снимок для клиента, который подключился посреди турна. */
  queues: () => SessionQueues;
  /** Записи дерева с курсором. Курсор считается в записях рантайма, а не в наших. */
  entries: (after?: number) => Promise<{ entries: SessionEntry[]; seen: number }>;
  /**
   * Свернуть контекст в пересказ. Это поход к модели: он стоит денег и занимает слот в очереди —
   * ставит его туда вызывающий, как и турн (docs/architecture.md).
   */
  compact: (instructions?: string) => Promise<CompactOutcome>;
  /**
   * Перейти к записи дерева, при желании пересказав покидаемую ветку. Возвращает результат целиком,
   * а не только новый лист: `editorText` — текст реплики, которую человек собрался переспросить
   * иначе, и доставить его вне ответа нечем (docs/sessions-and-projects.md).
   */
  navigate: (request: NavigateRequest) => Promise<NavigateOutcome>;
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
  /**
   * Ветка дерева: путь от записи вверх до корня либо до последней компакции. Живёт на записи, а не
   * на harness: ветка читается и у сессии, чью модель или чей плагин с агентом убрали.
   */
  branch: (fromId?: string) => Promise<BranchOutcome>;
  /**
   * Поставить или снять метку записи. Тоже мимо harness: это дозапись в дерево, а не поход к
   * модели, — ровно как имя сессии.
   */
  label: (entryId: string, label: string | null) => Promise<LabelOutcome>;
  /**
   * Насколько заполнен контекст действующей ветки. Harness для этого не нужен: контекст собирается
   * из записей, а окно берётся у модели каталога — её может не оказаться, и тогда доли не
   * существует.
   */
  contextUsage: () => Promise<ContextUsage>;
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

/**
 * `usage` у законченного турна — сумма по всем обращениям к модели внутри него, включая повторы и
 * вызовы инструментов (docs/hooks.md). Тип рантайма, поэтому наружу он уходит непрозрачным: ядру его
 * разбирать незачем, оно передаёт его подписчику как есть, а типизирует SDK.
 *
 * Траты компакции и пересказа ветки сюда не входят: они приходят своими событиями рантайма, и
 * считать их турном значило бы посчитать их дважды.
 */
export type TurnOutcome =
  { kind: "done"; usage?: unknown } | { kind: "busy" } | { kind: "failed"; reason: string };

/**
 * `text-only-model` — модель существует и годна, но не читает изображений, а ветка или само
 * сообщение их содержит. Отдельно от `unknown-model`: «модели нет» и «модель не та» человек чинит
 * по-разному, и одна причина на оба случая отправила бы его искать пропавшую модель.
 */
export type ModelOutcome =
  { kind: "applied" } | { kind: "unknown-model" } | { kind: "text-only-model" };

/**
 * Исход постановки сообщения в очередь. `idle` и `busy` — не сбой, а несовпадение с требованием
 * режима: стиринг и догоняющее требуют идущего турна, дозапись — простоя.
 */
export type MessageOutcome =
  { kind: "queued" } | { kind: "idle" } | { kind: "busy" } | { kind: "text-only-model" };

/**
 * Исход прерывания. `aborted: false` — прерывать было нечего.
 *
 * `cleared` — то, что прерывание вычистило из очередей рантайма: вклиненное и догоняющее, которых
 * модель так и не увидела. Отдаётся наружу, потому что решать судьбу написанного человеком —
 * не дело рантайма.
 */
export type AbortOutcome = { aborted: boolean; cleared: SessionQueuedMessage[] };

export type AgentSessionStats = Omit<SessionStats, "sessionId">;

/**
 * Исход компакции. `busy` — не сбой, а состояние: `compact()` у рантайма требует простоя ровно так
 * же, как `prompt`.
 */
export type CompactOutcome =
  { kind: "done" } | { kind: "busy" } | { kind: "failed"; reason: string };

/** Тело перехода к записи дерева. Повторяет `SessionNavigateRequest` протокола до поля. */
export type NavigateRequest = {
  entryId: string;
  summarize?: boolean;
  instructions?: string;
  replaceInstructions?: boolean;
};

/**
 * Исход перехода. `leafId` берётся у сессии после перехода, а не из ответа рантайма: `navigateTree`
 * новый лист не возвращает вовсе, а по цели его не вычислить — у реплики человека листом становится
 * её родитель.
 */
export type NavigateOutcome =
  | {
      kind: "navigated";
      leafId?: string;
      editorText?: string;
      summarized: boolean;
      cancelled: boolean;
    }
  | { kind: "busy" }
  | { kind: "unknown-entry" }
  | { kind: "failed"; reason: string };

/** Ветка дерева. Записи уже переведены в контракт, `leafId` — лист **сессии**, а не конец ветки. */
export type BranchOutcome =
  { kind: "branch"; entries: SessionEntry[]; leafId?: string } | { kind: "unknown-entry" };

/** Исход простановки метки. Указать не ту запись — обычная ошибка вызывающего, а не сбой. */
export type LabelOutcome = { kind: "labelled" } | { kind: "unknown-entry" };

/** Заполненность контекста. Окна может не быть: модель сессии могла пропасть из каталога. */
export type ContextUsage = { tokens: number; contextWindow?: number };

/**
 * Параметры компакции, которые Pi зашивает константой. `compact()` их не принимает, поэтому
 * платформа собирает компакцию сама и подсовывает её хуком (docs/sessions-and-projects.md).
 */
export type CompactionTuning = {
  /** Сколько токенов окна оставить под промпт пересказа и его ответ. */
  reserveTokens: number;
  /** Сколько хвоста разговора оставить как есть. */
  keepRecentTokens: number;
};

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
  /** Корень общих данных Sovereign, показываемый модели как отдельный от cwd runtime-контекст. */
  sovereignDataDirectory: string;
  /** Корень записей сессий внутри директории данных (docs/data-directory.md). */
  directory: string;
  /**
   * Корень архивных записей — сосед первого, а не папка внутри него: архивация переносит файл
   * между корнями, а вложенная папка притворилась бы папкой рабочей директории при обходе.
   */
  archivedDirectory: string;
  /**
   * Параметры компакции спрашиваются функцией, а не берутся значением при создании стора: то же
   * правило, что у предела одновременных турнов — `config.json` перечитывается на живом процессе, и
   * снимок, взятый однажды, устарел бы молча (docs/architecture.md).
   */
  compactionSettings: () => CompactionTuning;
  /**
   * Подписки плагинов на события рантайма (docs/hooks.md). Необязательны: без ядра, наполняющего
   * реестр подписок, рантайм работает как раньше и за фан-аут не платит.
   */
  hooks?: RuntimeHookSeam;
};

/**
 * Что стор подставляет каждой сессии. Одним объектом, а не растущим хвостом позиционных аргументов:
 * оба члена берутся у живого демона, и добавляется сюда то же самое — внедрённое, а не своё.
 */
type SessionSeams = {
  compactionSettings: () => CompactionTuning;
  sovereignDataDirectory: string;
  hooks?: RuntimeHookSeam;
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

    const persisted = persistedSession(session, options.models, summary, {
      compactionSettings: options.compactionSettings,
      sovereignDataDirectory: options.sovereignDataDirectory,
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
    });

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
  seams: SessionSeams,
  onClosed: () => void,
): AgentSession | { kind: "unknown-model" } {
  const model = resolveModel(models, summary.model);

  if (model === undefined) {
    return { kind: "unknown-model" };
  }

  const environment = new NodeExecutionEnv({ cwd: summary.folder });
  let instructions = agent.instructions;
  let agentDirectory = agent.directory;
  let skills: AgentSkill[] = [];
  const harness = new AgentHarness<ExecutionToolContext>({
    session,
    models,
    model,
    thinkingLevel: summary.thinkingLevel,
    tools: [],
    toolContext: { env: environment },
    systemPrompt: () =>
      [
        instructions,
        renderRuntimeContext({
          cwd: summary.folder,
          ...(agentDirectory === undefined ? {} : { agentPersonalDirectory: agentDirectory }),
          sovereignDataDirectory: seams.sovereignDataDirectory,
        }),
        renderSkillCatalogue(skills),
      ]
        .filter((section) => section !== "")
        .join("\n\n"),
  });

  /**
   * Шов сессии берётся один раз: контекст сессии от события к событию не меняется, а спрашивать его
   * на каждое событие означало бы платить за это на горячем пути `message_update`.
   */
  const hooks = seams.hooks?.for({
    sessionId: summary.id,
    projectId: summary.projectId,
    folder: summary.folder,
  });

  const listeners = new Set<(delta: SessionDelta) => void>();
  const publish = (delta: SessionDelta): void => {
    for (const listener of [...listeners]) {
      listener(delta);
    }
  };

  let phase: SessionPhase = "idle";
  let current: { turnId: string; aborted: boolean; messages: number } | undefined;
  /**
   * Трата идущего турна. Складывается из ответов модели и результатов инструментов: у турна несколько
   * обращений к провайдеру, а платит владелец за все (docs/hooks.md).
   */
  let spent: Usage | undefined;

  /**
   * Читает ли выбранная модель изображения. Неизвестная модель считается текстовой: у провайдера нет
   * безопасного «попробуем и посмотрим» — он либо ответит невнятной ошибкой, либо молча выбросит
   * картинку, и человек решит, что её посмотрели (docs/agent-runtime-contract.md).
   */
  const readsImages = (reference: string): boolean =>
    resolveModel(models, reference)?.input.includes("image") === true;

  /**
   * Есть ли изображение в действующей ветке. Спрашивается только тогда, когда модель текстовая:
   * ветка читается с диска, и платить за это на каждом турне с годной моделью незачем.
   */
  const branchHoldsImage = async (): Promise<boolean> => {
    // Именно ветка, а не весь файл: изображение в брошенной ветке в новый контекст не попадёт.
    const entries = await session.getBranch();

    return entries.some(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "user" &&
        imagesOf(entry.message.content).length > 0,
    );
  };

  /**
   * Годится ли модель для того, что сейчас поедет ей в контексте. Проверяется и само сообщение, и
   * ветка: после первой картинки текстовая модель не годится даже для чисто текстового продолжения —
   * контекст всё равно понесёт изображение.
   */
  const modelFits = async (images?: readonly SessionImage[]): Promise<boolean> => {
    if (readsImages(summary.model)) {
      return true;
    }

    return (images ?? []).length === 0 && !(await branchHoldsImage());
  };

  const setPhase = (next: SessionPhase): void => {
    if (phase === next) {
      return;
    }

    phase = next;
    publish({ kind: "phase", phase: next });
  };

  /**
   * Каркас турна: захват фазы, публикация исхода и учёт трат. Реплика человека и явно названный
   * скил различаются только тем, чем турн начинается, — всё остальное у них обязано совпадать до
   * буквы, иначе один из двух путей однажды перестанет публиковать событие или отпускать фазу.
   *
   * `refused` — отказ до первого обращения к модели: турна не было, поэтому и события об упавшем
   * турне нет.
   */
  const runTurn = async (
    turnId: string,
    start: () => Promise<
      { kind: "answered"; answer: AssistantMessage } | { kind: "refused"; reason: string }
    >,
  ): Promise<TurnOutcome> => {
    if (phase !== "idle") {
      return { kind: "busy" };
    }

    current = { turnId, aborted: false, messages: 0 };
    spent = undefined;
    setPhase("turn");

    try {
      const started = await start();

      if (started.kind === "refused") {
        return { kind: "failed", reason: started.reason };
      }

      const { answer } = started;

      if (answer.stopReason === "error") {
        publish({ kind: "turn-failed", reason: answer.errorMessage ?? "the turn failed" });

        return { kind: "failed", reason: answer.errorMessage ?? "the turn failed" };
      }

      publish(current.aborted ? { kind: "turn-aborted" } : { kind: "turn-end" });

      return spent === undefined ? { kind: "done" } : { kind: "done", usage: spent };
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
  };

  /**
   * Очереди рантайм наружу не отдаёт — только сообщает о смене событием, поэтому последнее
   * состояние приходится помнить: клиент, подключившийся посреди турна, спросит снимок.
   */
  let queues: SessionQueues = { steer: [], followUp: [] };

  /**
   * Одно наше звено на событие, а не по обработчику на подписчика: `emitHook` у Pi отдаёт победу
   * последнему вернувшему результат, и только `before_provider_request` с `before_provider_payload`
   * цепочку строят сами. Зарегистрируй по обработчику на плагин — получишь два разных правила на
   * восемь событий, поэтому цепочку мы строим внутри своего обработчика (docs/hooks.md).
   *
   * Здесь же исключение подписчика превращается в исход, а не доходит до Pi: у Pi исключение из
   * обработчика роняет турн (docs/agent-runtime-contract.md).
   */
  const chained = async <Name extends keyof AgentHarnessEventResultMap>(
    event: Name,
    received: Extract<AgentHarnessEvent, { type: Name }>,
    ours?: object,
  ): Promise<AgentHarnessEventResultMap[Name]> => {
    if (hooks === undefined || !hooks.subscribed(event)) {
      return answered<Name>(ours);
    }

    // Наше звено — первое: платформа управляет параметрами, плагин видит уже подготовленное. Своё
    // решение уезжает частью нагрузки, иначе следующее звено не увидело бы, что мы сделали.
    const rewritten = await hooks.rewrite(event, { ...withoutSignal(received), ...ours });

    if (rewritten.aborted !== undefined) {
      // Обрыв турна — исключение: другого способа остановить Pi посреди хука нет, и он тот же,
      // которым рантайм обрывает турн сам (docs/hooks.md).
      throw new AgentHarnessError(
        "hook",
        `the critical hook subscription ${rewritten.aborted.contributionId} stopped the turn: ${rewritten.aborted.reason}`,
      );
    }

    return answered<Name>({ ...ours, ...(rewritten.patch ?? {}) });
  };

  harness.subscribe((event) => {
    // Фан-аут наблюдательных событий подписчикам. Перехватывающие сюда не идут: их зовут свои
    // обработчики ниже, и подписчик, получивший событие дважды, увидел бы его и как наблюдение,
    // и как вмешательство (docs/hooks.md). `AbortSignal` среди наблюдательных не встречается — он
    // есть только у двух перезаписывающих, — поэтому нагрузка уезжает как есть.
    if (runtimeHookKinds[event.type] === "observing") {
      hooks?.observe(event.type, event);
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      spent = addUsage(spent, event.message.usage);
    }

    if (event.type === "tool_result") {
      spent = addUsage(spent, event.usage);
    }

    if (event.type === "queue_update") {
      queues = {
        steer: event.steer.map(queuedMessage),
        followUp: event.followUp.map(queuedMessage),
      };
      publish({ kind: "queues", queues });

      return;
    }

    translate(event, current, publish);
  });

  /**
   * Своя компакция вместо рантаймовой.
   *
   * Причина — не другие числа, а управляемость: `reserveTokens` и `keepRecentTokens` Pi берёт из
   * своей константы, а параметрами `compact()` их не принимает. Этот хук — единственная точка, где
   * их можно подставить: рантайм отдаёт сюда уже собранную подготовку и записи ветки, а вернувший
   * свою компакцию заменяет её целиком (docs/agent-runtime-contract.md).
   *
   * Настройки спрашиваются в момент компакции, а не при подъёме harness: `config.json`
   * перечитывается на живом процессе, и сессия, открытая до правки, обязана увидеть новое значение.
   */
  harness.on("session_before_compact", async (event) => {
    const prepared = prepareCompaction(event.branchEntries, {
      enabled: true,
      ...seams.compactionSettings(),
    });

    if (!prepared.ok) {
      throw prepared.error;
    }

    // Сворачивать нечего: ветка пуста либо уже кончается компакцией. Отмена честнее пустого
    // пересказа — она хотя бы не портит дерево записью ни о чём.
    if (prepared.value === undefined) {
      return chained("session_before_compact", event, { cancel: true });
    }

    const produced = await generateCompaction(
      prepared.value,
      harness.models,
      harness.getModel(),
      event.customInstructions,
      event.signal,
      harness.getThinkingLevel(),
    );

    if (!produced.ok) {
      throw produced.error;
    }

    return chained("session_before_compact", event, { compaction: produced.value });
  });

  // Остальные шесть перезаписывающих событий: своего звена у платформы нет, цепочка целиком плагинная.
  for (const event of rewritingWithoutOurLink) {
    harness.on(event, async (received) => chained(event, received));
  }

  /**
   * `tool_call` — решающий, а не перезаписывающий: он не переписывает данные, а запрещает действие.
   * Отказы едут модели одной причиной со всеми авторами: инструмент запретили, и знать, кто именно,
   * важно не меньше, чем почему (docs/hooks.md).
   */
  harness.on("tool_call", async (event) => {
    if (hooks === undefined) {
      return undefined;
    }

    // Два решающих хука на одно действие: событие Pi и хук платформы со своей нагрузкой. Спрашиваются
    // одновременно, а отказы сводятся вместе — запретили вызов, и авторов может быть несколько.
    const [byEvent, byPermission] = await Promise.all([
      hooks.subscribed("tool_call") ? hooks.decide("tool_call", event) : { refusals: [] },
      hooks.permission({ tool: event.toolName, arguments: event.input }),
    ]);
    const refusals = [...byEvent.refusals, ...byPermission.refusals];

    if (refusals.length === 0) {
      return undefined;
    }

    return { block: true, reason: refusalText(refusals) };
  });

  return {
    summary: () => ({ ...summary }),
    phase: () => phase,
    queues: () => ({
      steer: [...queues.steer],
      followUp: [...queues.followUp],
    }),
    message: async (text, mode, images) => {
      // Требования к занятости у режимов разные, и проверяются они здесь, а не в рантайме: у
      // рантайма это исключение `invalid_state`, а у нас — обычный исход, который маршрут переводит
      // в `409` с внятной причиной.
      // Требуется именно `turn`, а не «не простой»: обе очереди Pi вычитываются только изнутри
      // идущего турна (steer — каждым кругом внутреннего цикла, follow-up — там, где агент собрался
      // остановиться). В компакции и сводке ветки турна нет, и принятое сообщение легло бы в память
      // harness навсегда — ровно так оно и зависало.
      if ((mode === "steer" || mode === "follow-up") && phase !== "turn") {
        return { kind: "idle" };
      }

      if (mode === "append" && phase !== "idle") {
        return { kind: "busy" };
      }

      // Проверка до записи: принятое сообщение уже лежало бы в дереве, и отказ пришлось бы объяснять
      // человеку задним числом.
      if (!(await modelFits(images))) {
        return { kind: "text-only-model" };
      }

      const carried = toRuntimeImages(images);

      if (mode === "steer") {
        await harness.steer(text, { images: carried });
      } else if (mode === "follow-up") {
        await harness.followUp(text, { images: carried });
      } else {
        // У `appendMessage` нет `options.images`, поэтому содержимое складывается руками — в том же
        // порядке, в котором его складывают остальные три пути: текст, затем изображения.
        await harness.appendMessage({
          role: "user",
          content: [{ type: "text", text }, ...carried],
          timestamp: Date.now(),
        });
      }

      return { kind: "queued" };
    },
    prompt: async (text, turnId, images) =>
      runTurn(turnId, async () =>
        // Проверка модели уже внутри захваченной фазы: между проверкой занятости и `setPhase` не
        // должно быть ни одного `await`, иначе второй турн того же такта не увидит первого и
        // запустится рядом.
        (await modelFits(images))
          ? {
              kind: "answered",
              answer: await harness.prompt(text, { images: toRuntimeImages(images) }),
            }
          : { kind: "refused", reason: `the model ${summary.model} does not read images` },
      ),
    activateSkill: async (skill, turnId, instructions) =>
      runTurn(turnId, async () => {
        // Ресурс ставится на сам вызов и в системный prompt не попадает: каталог там собирается
        // нашим `renderSkillCatalogue`, а полный текст скила уезжает модели ровно один раз —
        // первым сообщением этого турна (docs/agent-runtime-contract.md).
        await harness.setResources({
          skills: [
            {
              name: skill.name,
              description: skill.description,
              filePath: skill.location,
              content: skill.content,
            },
          ],
        });

        return { kind: "answered", answer: await harness.skill(skill.name, instructions) };
      }),
    runPromptTemplate: async (template, turnId, args) =>
      runTurn(turnId, async () => {
        // Ресурс на один вызов — по той же причине, что у скила: держать все шаблоны в памяти
        // harness незачем, а системный prompt о них не знает вовсе.
        await harness.setResources({
          promptTemplates: [
            { name: template.name, description: template.description, content: template.content },
          ],
        });

        return {
          kind: "answered",
          answer: await harness.promptFromTemplate(
            template.name,
            args === undefined ? [] : parseCommandArgs(args),
          ),
        };
      }),
    abort: async () => {
      if (current === undefined) {
        return { aborted: false, cleared: [] };
      }

      current.aborted = true;

      const dropped = await harness.abort();

      // Вычищенное отдаётся вызывающему, а не выбрасывается: человек это написал, модель этого не
      // видела, и молчаливая пропажа написанного — тот самый дефект, из-за которого заводилась
      // очередь сессии. Порядок отправки сохраняется: стиринг раньше догоняющего.
      return {
        aborted: true,
        cleared: [...dropped.clearedSteer, ...dropped.clearedFollowUp].map(queuedMessage),
      };
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

      // Модель годна сама по себе, но не для этой ветки: в контексте уже лежит изображение, и
      // текстовая модель не сможет продолжить разговор даже чисто текстовым сообщением.
      if (!next.input.includes("image") && (await branchHoldsImage())) {
        return { kind: "text-only-model" };
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
    setInstructions: (next) => {
      if (next === "") {
        throw new Error("agent instructions must not be empty");
      }

      instructions = next;
    },
    setAgentDirectory: (next) => {
      agentDirectory = next;
    },
    setSkills: (next) => {
      skills = [...next];
    },
    entries: async (after = 0) => {
      return entriesOf(session, after);
    },
    compact: async (instructions) => {
      // Проверка и смена состояния идут до первого `await`, поэтому вторая компакция, пришедшая в
      // том же такте, отказ получает здесь, а не исключением `busy` из рантайма.
      if (phase !== "idle") {
        return { kind: "busy" };
      }

      setPhase("compaction");

      try {
        // Компакция — такой же поход к модели, как турн: она пересказывает ту же ветку и наткнётся
        // на то же изображение. Проверка внутри захваченной фазы по той же причине, что у турна.
        if (!(await modelFits())) {
          return { kind: "failed", reason: `the model ${summary.model} does not read images` };
        }

        await harness.compact(instructions);

        return { kind: "done" };
      } catch (cause) {
        if (cause instanceof AgentHarnessError && cause.code === "busy") {
          return { kind: "busy" };
        }

        return { kind: "failed", reason: describe(cause) };
      } finally {
        setPhase("idle");
      }
    },
    navigate: async (request) => {
      if (phase !== "idle") {
        return { kind: "busy" };
      }

      // Фаза одна на переход с пересказом и без него: рантайм различает их только тем, ходит ли он
      // к модели, а состояние `branch_summary` присваивает в обоих случаях.
      setPhase("branch-summary");

      try {
        // Переход без пересказа к модели не ходит и картинок не касается — проверяется только заказ
        // пересказа покидаемой ветки.
        if (request.summarize === true && !(await modelFits())) {
          return { kind: "failed", reason: `the model ${summary.model} does not read images` };
        }

        const moved = await harness.navigateTree(request.entryId, {
          ...(request.summarize === undefined ? {} : { summarize: request.summarize }),
          ...(request.instructions === undefined
            ? {}
            : { customInstructions: request.instructions }),
          ...(request.replaceInstructions === undefined
            ? {}
            : { replaceInstructions: request.replaceInstructions }),
        });
        // Лист спрашивается у сессии: в ответе рантайма его нет, а по цели он не выводится — у
        // реплики человека листом становится её родитель, чтобы вопрос можно было задать иначе.
        const leafId = await session.getLeafId();

        return {
          kind: "navigated",
          ...(leafId === null ? {} : { leafId }),
          ...(moved.editorText === undefined ? {} : { editorText: moved.editorText }),
          summarized: moved.summaryEntry !== undefined,
          cancelled: moved.cancelled,
        };
      } catch (cause) {
        if (cause instanceof AgentHarnessError && cause.code === "busy") {
          return { kind: "busy" };
        }

        // Не та запись — обычная ошибка вызывающего, и она приезжает исходом, как у форка.
        if (cause instanceof AgentHarnessError && cause.code === "invalid_argument") {
          return { kind: "unknown-entry" };
        }

        return { kind: "failed", reason: describe(cause) };
      } finally {
        setPhase("idle");
      }
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
  seams: SessionSeams,
): PersistedAgentSession {
  let live: AgentSession | undefined;

  return {
    summary: () => ({ ...summary }),
    entries: (after = 0) => entriesOf(session, after),
    branch: async (fromId) => {
      let found: SessionTreeEntry[];

      try {
        found = await session.getBranch(fromId);
      } catch (cause) {
        if (cause instanceof SessionError && cause.code === "not_found") {
          return { kind: "unknown-entry" };
        }

        throw cause;
      }

      const leafId = await session.getLeafId();

      return {
        kind: "branch",
        entries: found.flatMap(describeEntry),
        ...(leafId === null ? {} : { leafId }),
      };
    },
    label: async (entryId, label) => {
      try {
        // Снятие метки — такая же запись, только без значения: действующее значение это свёртка
        // всех записей `label` по цели, а не последнее непустое.
        await session.appendLabel(entryId, label ?? undefined);
      } catch (cause) {
        if (cause instanceof SessionError && cause.code === "not_found") {
          return { kind: "unknown-entry" };
        }

        throw cause;
      }

      return { kind: "labelled" };
    },
    contextUsage: async () => {
      const context = await session.buildContext();
      const model = resolveModel(models, summary.model);

      return {
        tokens: estimateContextTokens(context.messages).tokens,
        ...(model === undefined ? {} : { contextWindow: model.contextWindow }),
      };
    },
    activate: (agent) => {
      if (live !== undefined) {
        return live;
      }

      const started = liveSession(session, models, agent, summary, seams, () => {
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

      const images = imagesOf(event.message.content);

      // Отдельным кадром и только при наличии: у большинства сообщений картинок нет, и пустой
      // список гнал бы через поток кадр ни о чём на каждую реплику.
      if (images.length > 0) {
        publish({ kind: "message-images", messageId, images });
      }
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
 * Перевод записи дерева. Разобраны все одиннадцать типов записей рантайма; `other` остаётся под то,
 * чего рантайм ещё не умеет: обновление Pi, принёсшее новый тип записи, обязано доехать до клиента
 * хоть чем-то. Молчаливая потеря записи сделала бы ленту неполной без всякого следа.
 */
function describeEntry(entry: SessionTreeEntry): SessionEntry[] {
  // Тип читается до разбора: когда разобраны все известные виды, для компилятора `entry` становится
  // `never`, и незнакомой записи неоткуда взять своё имя.
  const type: string = entry.type;
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
      : [{ ...common, kind: "other", type }];
  }

  if (entry.type === "active_tools_change") {
    return [{ ...common, kind: "tools-change", toolNames: [...entry.activeToolNames] }];
  }

  if (entry.type === "compaction") {
    // `fromHook` у рантайма необязателен, у нас — обязателен: отсутствие значит «считал сам
    // harness», и превращать эту разницу в третье состояние незачем.
    return [
      {
        ...common,
        kind: "compaction",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        ...(entry.firstKeptEntryId === undefined
          ? {}
          : { firstKeptEntryId: entry.firstKeptEntryId }),
        fromHook: entry.fromHook ?? false,
      },
    ];
  }

  if (entry.type === "branch_summary") {
    return [
      {
        ...common,
        kind: "branch-summary",
        fromId: entry.fromId,
        summary: entry.summary,
        fromHook: entry.fromHook ?? false,
      },
    ];
  }

  if (entry.type === "label") {
    // Метки без значения не бывает — бывает снятая: рантайм пишет снятие такой же записью, только
    // без текста, и отсутствие поля здесь значит именно это.
    return [
      {
        ...common,
        kind: "label",
        targetId: entry.targetId,
        ...(entry.label === undefined ? {} : { label: entry.label }),
      },
    ];
  }

  if (entry.type === "session_info") {
    return [
      {
        ...common,
        kind: "session-name",
        ...(entry.name === undefined ? {} : { name: entry.name }),
      },
    ];
  }

  if (entry.type === "leaf") {
    // `null` у рантайма — «дерево вернули в пустое состояние»; наружу это отсутствие поля.
    return [
      {
        ...common,
        kind: "leaf",
        ...(entry.targetId === null ? {} : { targetId: entry.targetId }),
      },
    ];
  }

  if (entry.type === "custom") {
    return [
      {
        ...common,
        kind: "custom",
        type: entry.customType,
        ...(entry.data === undefined ? {} : { data: entry.data }),
      },
    ];
  }

  if (entry.type === "custom_message") {
    return [
      {
        ...common,
        kind: "custom-message",
        type: entry.customType,
        text: textOf(entry.content),
        display: entry.display,
      },
    ];
  }

  if (entry.type !== "message") {
    return [{ ...common, kind: "other", type }];
  }

  const message = entry.message;

  if (message.role === "user") {
    return [
      {
        ...common,
        kind: "message",
        // Тот же перевод, что у ответа модели, а не свёртка в один текст: у сообщения человека
        // бывают изображения, и порядок блоков — это порядок, в котором он их написал.
        role: "user",
        content: blocksOf(asContent(message.content)),
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

/** Содержимое сообщения рантайма списком: у сообщения человека оно бывает просто строкой. */
function asContent(content: unknown): readonly unknown[] {
  if (Array.isArray(content)) {
    return content;
  }

  return typeof content === "string" ? [{ type: "text", text: content }] : [];
}

function blocksOf(content: readonly unknown[]): SessionContentBlock[] {
  const blocks: SessionContentBlock[] = [];

  for (const piece of content) {
    const part = piece as {
      type?: string;
      text?: string;
      thinking?: string;
      data?: unknown;
      mimeType?: unknown;
    };

    // Пустой текстовый блок пропускается: перед изображением его ставит сам рантайм, и показывать
    // его значило бы рисовать в ленте абзац, которого человек не писал.
    if (part.type === "text" && typeof part.text === "string" && part.text !== "") {
      blocks.push({ kind: "text", text: part.text });
    }

    if (
      part.type === "image" &&
      typeof part.data === "string" &&
      isSessionImageMimeType(part.mimeType)
    ) {
      blocks.push({ kind: "image", mimeType: part.mimeType, data: part.data });
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
 * Сложить траты. Своего отчёта мы не заводим — складывается тип рантайма, поле к полю: то, чего Pi не
 * различает, не различаем и мы (docs/hooks.md).
 */
function addUsage(total: Usage | undefined, added: Usage | undefined): Usage | undefined {
  if (added === undefined) {
    return total;
  }

  if (total === undefined) {
    return added;
  }

  const cacheWrite1h = addReported(total.cacheWrite1h, added.cacheWrite1h);
  const reasoning = addReported(total.reasoning, added.reasoning);

  return {
    input: total.input + added.input,
    output: total.output + added.output,
    cacheRead: total.cacheRead + added.cacheRead,
    cacheWrite: total.cacheWrite + added.cacheWrite,
    totalTokens: total.totalTokens + added.totalTokens,
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
    ...(reasoning === undefined ? {} : { reasoning }),
    cost: {
      input: total.cost.input + added.cost.input,
      output: total.cost.output + added.cost.output,
      cacheRead: total.cost.cacheRead + added.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + added.cost.cacheWrite,
      total: total.cost.total + added.cost.total,
    },
  };
}

/**
 * Необязательные разбивки Pi: `undefined` значит «провайдер этого не сообщает», и это не ноль.
 * Складывать их как ноль значило бы выдать несообщённое за посчитанное; терять при сложении — забыть
 * разбивку, которую провайдер дал.
 */
function addReported(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

/**
 * Пустое — это «ничего не менялось», и оно уезжает `undefined`. Пустой объект Pi принял бы за
 * результат и применил бы поправку без полей; отдельного способа сказать «я ничего не меняю», кроме
 * возврата ничего, нет (docs/hooks.md).
 *
 * Приведение неизбежно: поправка приехала из воркера данными, и её форму держит типизированный
 * обработчик в SDK, а не проверка здесь — проверять её нечем, схемы у события нет.
 */
function answered<Name extends keyof AgentHarnessEventResultMap>(
  fields?: object,
): AgentHarnessEventResultMap[Name] {
  const changed = fields !== undefined && Object.keys(fields).length > 0;

  return (changed ? fields : undefined) as AgentHarnessEventResultMap[Name];
}

/**
 * Перезаписывающие события, у которых своего звена у платформы нет. `session_before_compact` в
 * список не входит: там первое звено наше, и цепочку начинает оно (docs/hooks.md).
 */
const rewritingWithoutOurLink = (
  Object.entries(runtimeHookKinds) as [
    RuntimeHookName,
    (typeof runtimeHookKinds)[RuntimeHookName],
  ][]
)
  .filter(([event, kind]) => kind === "rewriting" && event !== "session_before_compact")
  .map(([event]) => event as keyof AgentHarnessEventResultMap);

/**
 * `AbortSignal` не переживает структурное клонирование, а нагрузка едет в воркер плагина. Поле
 * убирается, а не переописывается: имена и формы остальных полей остаются пиевскими
 * (docs/hooks.md).
 */
function withoutSignal(event: object): object {
  if (!("signal" in event)) {
    return event;
  }

  const fields = { ...(event as Record<string, unknown>) };
  delete fields["signal"];

  return fields;
}

/** Одна причина со всеми авторами: запретили инструмент вместе, и это должно быть видно. */
function refusalText(refusals: RuntimeHookRefusal[]): string {
  return refusals.map((refusal) => `${refusal.contributionId}: ${refusal.reason}`).join("; ");
}

/**
 * Сообщение, ждущее в очереди. В очередях лежат сообщения человека, но тип рантайма шире — в нём
 * есть и сообщения без содержимого вовсе, и пустая строка для них честнее выдумки.
 *
 * Картинки едут вместе с текстом: очередь показывают человеку, и очередь из одних текстов показала
 * бы ему не то, что он отправил.
 */
function queuedMessage(message: object): SessionQueuedMessage {
  if (!("content" in message)) {
    return { text: "" };
  }

  const images = imagesOf(message.content);

  return {
    text: textOf(message.content),
    ...(images.length === 0 ? {} : { images }),
  };
}

/** Изображения содержимого сообщения рантайма в порядке, в котором они там лежат. */
function imagesOf(content: unknown): SessionImage[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((piece) => {
    const part = piece as { type?: string; data?: unknown; mimeType?: unknown };

    // Тип изображения у рантайма — просто строка: он не обещает, что она из нашего списка. Чужой
    // формат мы наружу не выпускаем — иначе публичное объединение перестало бы быть закрытым.
    return part.type === "image" &&
      typeof part.data === "string" &&
      isSessionImageMimeType(part.mimeType)
      ? [{ mimeType: part.mimeType, data: part.data }]
      : [];
  });
}

/**
 * Изображения в том виде, в котором их принимает рантайм. Один перевод на все четыре пути: разные
 * реализации `prompt`, `steer`, `follow-up` и `append` быстро разошлись бы в порядке блоков и в
 * том, что считается сообщением без текста.
 */
function toRuntimeImages(images: readonly SessionImage[] | undefined) {
  return (images ?? []).map((image) => ({
    type: "image" as const,
    data: image.data,
    mimeType: image.mimeType,
  }));
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
