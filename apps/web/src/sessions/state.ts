/**
 * Состояние вью сессий и его правила. Логика живёт здесь, а не в хуке, потому что проверяется она
 * тестом, а не глазами.
 *
 * Три правила держат весь модуль, и каждое из них — следствие устройства контракта, а не вкус:
 *
 * 1. **Поток и записи не склеиваются.** `messageId` дельты синтетический (`<turnId>:<n>`), записи с
 *    таким идентификатором не существует ни до, ни после турна (docs/web-api.md). Склей мы их — на
 *    каждом турне в ленте появлялся бы дубликат. Поэтому буфер турна показывается вместо конца
 *    ленты, а на конце турна выбрасывается целиком, и записи дочитываются с курсора.
 * 2. **«Турн идёт» берётся из фазы сессии, а не из дельт.** Турн, прерванный в очереди, не даёт ни
 *    одной дельты — только событие шины. Ожидание, повешенное на дельты, зависло бы навсегда.
 * 3. **Переподъём потока обнуляет буфер.** Дельты не лежат ни в окне догона, ни на шине, и вернуть
 *    их нечем: после подъёма перечитываются снимок и записи.
 */

import {
  coreEventTypes,
  foldEntryLabels,
  isPluginStreamEvent,
  streamGapType,
  type AgentSummary,
  type BusStreamEvent,
  type ModelSummary,
  type Project,
  type ProviderSummary,
  type Session,
  type SessionBranch,
  type SessionCommands,
  type SessionContextUsage,
  type SessionDelta,
  type SessionImage,
  type SessionEntry,
  type SessionQueues,
  type SessionsSnapshot,
  type SessionStats,
} from "@sovereign/protocol";

/** Сообщение, которое ещё едет. Каналы разделены: размышления показываются свёрнутыми отдельно. */
export type StreamedMessage = {
  kind: "message";
  messageId: string;
  role: "user" | "agent";
  text: string;
  reasoning: string;
  /** Изображения приезжают отдельным кадром и только у сообщения человека: он их и приложил. */
  images: SessionImage[];
  done: boolean;
};

/** Вызов инструмента в идущем турне. Вывода здесь нет: в потоке его не бывает вовсе. */
export type StreamedTool = {
  kind: "tool";
  toolCallId: string;
  toolName: string;
  input: unknown;
  failed?: boolean;
  done: boolean;
};

export type StreamedItem = StreamedMessage | StreamedTool;

export type LiveTurn = {
  turnId: string;
  /** Порядок появления: модель чередует текст и вызовы, и лента обязана сохранить это чередование. */
  order: string[];
  items: Record<string, StreamedItem>;
};

export type OpenSession = {
  id: string;
  /** Снимок сессии — источник истины по фазе, модели и уровню размышлений. */
  summary?: Session;
  entries: SessionEntry[];
  /** Курсор из `SessionEntriesPage.seen`, а не длина `entries`: он считается в записях рантайма. */
  seen: number;
  live?: LiveTurn;
  /**
   * Текст турна, **вставшего в очередь**. Дельт он не даёт вовсе, и без этого реплика человека
   * появлялась бы в ленте только когда очередь до неё дойдёт. У начатого турна запись пишется сразу,
   * и класть его сюда значит показать реплику дважды до самого конца работы.
   */
  pending: Record<string, string>;
  /** Причина `turn-failed` или отказа демона. Английская фраза уходит ещё и в диагностику. */
  failure?: string;
  /**
   * Что ждёт в очередях. Приезжает дельтой `queues`: написавший стиринг обязан видеть, что тот
   * принят и ждёт, а не пропал (docs/web-api.md).
   */
  queues?: SessionQueues;
  /** Токены и деньги. Спрашиваются отдельным запросом по открытию сессии и по концу турна. */
  stats?: SessionStats;
  /**
   * Насколько заполнен контекст. Не то же, что `stats`: та отвечает «сколько заплачено» по всему
   * файлу, эта — «сколько ещё влезет» в действующую ветку (docs/sessions-and-projects.md).
   */
  context?: SessionContextUsage;
  /**
   * Что предлагает композер по `/`. Спрашивается вместе с остальным снимком и перечитывается на
   * смену вкладов: включённый плагин со скилом обязан появиться в каталоге без перезагрузки.
   */
  commands?: SessionCommands;
  /**
   * Действующие метки записей. Свёртка, а не список записей `label`: снятие рантайм пишет такой же
   * записью, и «есть ли метка» — это результат свёртки, а не наличие записи (docs/web-api.md).
   * Считается по прочитанным записям, поэтому живёт рядом с ними, а не спрашивается отдельно.
   */
  labels: Map<string, string>;
  /**
   * Лист сессии: запись, от которой пойдёт следующий турн. Из ответа `GET .../branch` берётся также
   * набор записей пути: дерево хранится одним списком, а лента обязана показать только этот путь.
   * Вывести лист из записей нечем: после перехода он лежит не в конце файла.
   */
  leafId?: string;
  /** Идентификаторы активной ветки, выведенные из `GET .../branch`, без второй копии записей. */
  branchEntryIds: Set<string>;
  /**
   * Чего сессия лишилась на ходу: инструмент исчез вместе с плагином или модель пропала из
   * каталога. Копится списком, потому что за одну пересборку набора пропасть может несколько
   * инструментов (docs/sessions-and-projects.md).
   */
  degradations: { kind: "tool" | "model"; name: string }[];
  loading: boolean;
};

/**
 * Модели одного провайдера. Спрашиваются по выбору провайдера в диалоге создания, а не все сразу:
 * на все провайдеры их больше тысячи (docs/web-api.md).
 */
export type ModelsEntry =
  | { kind: "loading" }
  | { kind: "ready"; models: ModelSummary[] }
  | { kind: "failed"; reason: string };

export type SessionsState = {
  /** `undefined` — снимка ещё нет. Это не пустой список, и показывать надо ожидание, а не «пусто». */
  sessions?: Session[];
  /** Сессии, чей файл прочитать не вышло. Одна битая не отменяет остальные. */
  problems: string[];
  agents?: AgentSummary[];
  /** Всё, что нужно диалогу создания. Спрашивается по его открытию, а не на каждом подъёме потока. */
  projects?: Project[];
  providers?: ProviderSummary[];
  models: Record<string, ModelsEntry>;
  open?: OpenSession;
  failure?: string;
  /** Список показывает архив вместо действующих сессий. Фильтр, а не второй список рядом. */
  showArchived: boolean;
};

export const initialSessionsState: SessionsState = {
  problems: [],
  models: {},
  showArchived: false,
};

/** Переключить список между действующими и архивными. Список после этого перезапрашивается. */
export function showArchived(state: SessionsState, archived: boolean): SessionsState {
  return { ...state, showArchived: archived, sessions: undefined };
}

/**
 * Список сессий. Снимок открытой сессии он не трогает: сессия архивного проекта из списка пропадает,
 * оставаясь читаемой по своему адресу (docs/web-api.md), и «нет в списке» не значит «нет вовсе».
 * За открытую отвечает `applySummary`.
 */
export function applySessions(state: SessionsState, snapshot: SessionsSnapshot): SessionsState {
  return {
    ...state,
    sessions: snapshot.sessions,
    problems: snapshot.problems ?? [],
    failure: undefined,
  };
}

/** Снимок открытой сессии: источник истины по фазе. `undefined` — сессии больше нет. */
export function applySummary(
  state: SessionsState,
  sessionId: string,
  summary: Session | undefined,
): SessionsState {
  const open = state.open;

  if (open?.id !== sessionId) {
    return state;
  }

  // Снятый с очереди турн не даёт финальной дельты. Его исход подтверждает только следующий
  // снимок: как только прежний `queued` сменился другой фазой, локальный текст больше не ждёт.
  const pending =
    open.summary?.phase === "queued" && summary?.phase !== "queued" ? {} : open.pending;

  return {
    ...state,
    open: {
      ...open,
      summary,
      pending,
      ...(summary === undefined ? { loading: false, failure: undefined } : {}),
    },
  };
}

export function applyAgents(state: SessionsState, agents: AgentSummary[]): SessionsState {
  return { ...state, agents };
}

/** Проекты для диалога: архивные и пропавшие отсеиваются здесь — создать сессию в них нельзя. */
export function applyProjects(state: SessionsState, projects: Project[]): SessionsState {
  return {
    ...state,
    projects: projects.filter(
      (project) => !project.archived && project.availability === "available",
    ),
  };
}

/** Провайдеры для диалога: без креда модель всё равно не поедет, и выбирать там нечего. */
export function applyProviders(state: SessionsState, providers: ProviderSummary[]): SessionsState {
  return {
    ...state,
    providers: providers.filter((provider) => provider.auth.kind === "configured"),
  };
}

export function startModels(state: SessionsState, providerId: string): SessionsState {
  return { ...state, models: { ...state.models, [providerId]: { kind: "loading" } } };
}

export function applyModels(
  state: SessionsState,
  providerId: string,
  models: ModelSummary[],
): SessionsState {
  return { ...state, models: { ...state.models, [providerId]: { kind: "ready", models } } };
}

export function applyModelsFailure(
  state: SessionsState,
  providerId: string,
  reason: string,
): SessionsState {
  return { ...state, models: { ...state.models, [providerId]: { kind: "failed", reason } } };
}

export function applyFailure(state: SessionsState, reason: string): SessionsState {
  return { ...state, failure: reason };
}

/** Открытие сессии: всё, что осталось от прошлой, выбрасывается — общего у них нет ничего. */
export function openSession(state: SessionsState, sessionId: string): SessionsState {
  if (state.open?.id === sessionId) {
    return state;
  }

  return {
    ...state,
    open: {
      id: sessionId,
      summary: state.sessions?.find(({ id }) => id === sessionId),
      entries: [],
      seen: 0,
      labels: new Map(),
      branchEntryIds: new Set(),
      pending: {},
      degradations: [],
      loading: true,
    },
  };
}

export function closeSession(state: SessionsState): SessionsState {
  return { ...state, open: undefined };
}

/** Страница записей приходит приращением от курсора, и складывается она так же. */
export function applyEntries(
  state: SessionsState,
  sessionId: string,
  entries: SessionEntry[],
  seen: number,
): SessionsState {
  const open = state.open;

  if (open?.id !== sessionId) {
    return state;
  }

  const grown = [...open.entries, ...entries];

  // Метки пересчитываются по всей ленте, а не по приросту: страница могла принести снятие метки,
  // поставленной страницей раньше, и сложение приращением потеряло бы порядок этих двух записей.
  return {
    ...state,
    open: { ...open, entries: grown, labels: foldEntryLabels(grown), seen, loading: false },
  };
}

/**
 * Попадает ли запись в ленту. Правило живёт здесь, а не в разметке: типов записей одиннадцать
 * (docs/sessions-and-projects.md), и «что человек видит в переписке» — решение, а не деталь показа.
 *
 * - `compaction` и `branch-summary` **видны**: свёртка выбрасывает из контекста часть разговора, и не
 *   показать её значит оставить агента «забывшим» без следа в ленте;
 * - `custom-message` — запись приложения, которая и есть реплика: показывается ровно при `display`;
 * - `tool-result` скрыт, потому что его показывает сам вызов инструмента, найдя по `toolCallId`;
 * - `label`, `leaf`, `session-name` скрыты: это не реплики, а состояние дерева и его пометки;
 * - `custom` скрыт: модели она не показана, а платформенное содержимое (деградация) приезжает во вью
 *   событием шины и рисуется врезкой;
 * - `tools-change` и `other` скрыты по-прежнему: показывать в переписке нечего.
 */
export function isFeedEntry(entry: SessionEntry): boolean {
  switch (entry.kind) {
    case "message":
    case "model-change":
    case "thinking-level-change":
    case "compaction":
    case "branch-summary":
      return true;

    case "custom-message":
      return entry.display;

    default:
      return false;
  }
}

/** Узел дерева записей. Своей подписи здесь нет: переводит запись в строку вью, а не правило. */
export type EntryTreeNode = {
  entry: SessionEntry;
  children: EntryTreeNode[];
};

/**
 * Дерево записей из плоского списка, по `parentId`.
 *
 * **Вложенность появляется только в точках ветвления.** Прогон записей, у каждой из которых ровно
 * один ребёнок, ложится плоской чередой сиблингов на один уровень: у разговора в сто реплик иначе
 * было бы сто уровней отступа, и панель стала бы лестницей.
 *
 * В точке ветвления каждая ветка уезжает под свою первую запись — иначе два прогона легли бы
 * вперемешку на один уровень, и по дереву стало бы невозможно сказать, чей ответ чей.
 *
 * Запись, чей родитель не прочитан, считается корнем: пропасть из дерева она не имеет права, а
 * потерянный родитель — это либо начало файла, либо ещё не доехавшая страница.
 */
export function buildEntryTree(entries: readonly SessionEntry[]): EntryTreeNode[] {
  const known = new Set(entries.map(({ id }) => id));
  const byParent = new Map<string, SessionEntry[]>();
  const roots: SessionEntry[] = [];

  for (const entry of entries) {
    const parentId = entry.parentId;

    if (parentId === undefined || !known.has(parentId)) {
      roots.push(entry);
      continue;
    }

    const siblings = byParent.get(parentId);

    if (siblings === undefined) {
      byParent.set(parentId, [entry]);
    } else {
      siblings.push(entry);
    }
  }

  // Испорченный файл может замкнуть `parentId` в кольцо, и обход по нему не кончился бы никогда.
  const visited = new Set<string>();

  /** Прогон от записи вниз: пока ребёнок ровно один, следующая запись — сиблинг, а не потомок. */
  function runFrom(start: SessionEntry): EntryTreeNode[] {
    const line: EntryTreeNode[] = [];
    let current: SessionEntry | undefined = start;

    while (current !== undefined && !visited.has(current.id)) {
      visited.add(current.id);

      // Типы названы явно: без них вывод замыкается через `nest` на самого себя и сдаётся.
      const children: SessionEntry[] = byParent.get(current.id) ?? [];
      const only: SessionEntry | undefined = children.length === 1 ? children[0] : undefined;

      if (only !== undefined) {
        line.push({ entry: current, children: [] });
        current = only;
        continue;
      }

      line.push({ entry: current, children: children.map(nest) });
      current = undefined;
    }

    return line;
  }

  /** Ветка целиком под своей первой записью: остаток прогона становится её детьми. */
  function nest(entry: SessionEntry): EntryTreeNode {
    const [head, ...rest] = runFrom(entry);

    // Пусто всегда одно из двух: у ветвящейся записи прогон обрывается на ней самой, у линейной
    // детей нет вовсе.
    return { entry, children: [...(head?.children ?? []), ...rest] };
  }

  const tree = roots.flatMap(runFrom);
  // Кольцо в `parentId` не оставляет ни одного корня, и дерево вышло бы пустым — то есть записи
  // пропали бы молча. Не дошедшие до обхода дописываются корнями: испорченный файл виден, а не нем.
  const unreached = entries.filter(({ id }) => !visited.has(id));

  return unreached.length === 0 ? tree : [...tree, ...unreached.flatMap(runFrom)];
}

/**
 * Путь от корня до записи по `parentId`, включая её саму. Из него получается набор раскрытых узлов:
 * панель дерева обязана открыться на той ветке, в которой сессия работает сейчас.
 */
export function entryPath(entries: readonly SessionEntry[], entryId: string | undefined): string[] {
  if (entryId === undefined) {
    return [];
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(entryId);

  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }

  return path;
}

/**
 * Турн отправлен. Текст показывается сразу, до первой дельты: в очереди дельт нет, и без этого
 * реплика человека появлялась бы с задержкой в целый турн впереди.
 */
export function applyPendingTurn(
  state: SessionsState,
  sessionId: string,
  turnId: string,
  text: string,
): SessionsState {
  const open = state.open;

  if (open?.id !== sessionId) {
    return state;
  }

  return {
    ...state,
    open: { ...open, pending: { ...open.pending, [turnId]: text }, failure: undefined },
  };
}

/** Очереди приезжают целиком, а не приращением: у дельты в них лежит всё, что ждёт прямо сейчас. */
export function applyQueues(
  state: SessionsState,
  sessionId: string,
  queues: SessionQueues,
): SessionsState {
  const open = state.open;

  return open?.id === sessionId ? { ...state, open: { ...open, queues } } : state;
}

export function applyStats(
  state: SessionsState,
  sessionId: string,
  stats: SessionStats | undefined,
): SessionsState {
  const open = state.open;

  return open?.id === sessionId ? { ...state, open: { ...open, stats } } : state;
}

/**
 * Ветка сессии. Дерево хранится одним списком, поэтому из ответа берутся лист и идентификаторы
 * активного пути, а не вторая копия его записей. Ветка спрашивается вместе со снимком при initial /
 * reconnect и перечитывается после перехода.
 */
export function applyBranch(
  state: SessionsState,
  sessionId: string,
  branch: SessionBranch | undefined,
): SessionsState {
  const open = state.open;

  return open?.id === sessionId
    ? {
        ...state,
        open: {
          ...open,
          leafId: branch?.leafId,
          branchEntryIds: new Set(branch?.entries.map(({ id }) => id)),
        },
      }
    : state;
}

/** Начало нового чтения ветки: старый путь нельзя показывать поверх нового снимка. */
export function resetBranch(state: SessionsState, sessionId: string): SessionsState {
  const open = state.open;

  return open?.id === sessionId
    ? { ...state, open: { ...open, leafId: undefined, branchEntryIds: new Set() } }
    : state;
}

/**
 * Заполнение контекста. Приходит вместе со снимком: меняется оно тогда же, когда фаза, — турн
 * дописал ветку или компакция её свернула. Пропавшая сессия отвечает `undefined`, и показывать
 * прежнее число нельзя: оно уже ни о чём.
 */
export function applyContext(
  state: SessionsState,
  sessionId: string,
  context: SessionContextUsage | undefined,
): SessionsState {
  const open = state.open;

  return open?.id === sessionId ? { ...state, open: { ...open, context } } : state;
}

export function applyCommands(
  state: SessionsState,
  sessionId: string,
  commands: SessionCommands | undefined,
): SessionsState {
  const open = state.open;

  return open?.id === sessionId ? { ...state, open: { ...open, commands } } : state;
}

/**
 * Сессия лишилась опоры. Копится списком, а не заменяется: за одну пересборку набора пропасть может
 * несколько инструментов, и последнее сообщение стёрло бы остальные.
 */
export function applyDegradation(
  state: SessionsState,
  sessionId: string,
  degradation: { kind: "tool" | "model"; name: string },
): SessionsState {
  const open = state.open;

  if (open?.id !== sessionId) {
    return state;
  }

  return { ...state, open: { ...open, degradations: [...open.degradations, degradation] } };
}

export function applyTurnFailure(
  state: SessionsState,
  sessionId: string,
  reason: string,
): SessionsState {
  const open = state.open;

  if (open?.id !== sessionId) {
    return state;
  }

  return { ...state, open: { ...open, failure: reason } };
}

/** Ошибка снимка прекращает ожидание загрузки, не меняя семантику отказа отдельного турна. */
export function applyOpenFailure(
  state: SessionsState,
  sessionId: string,
  reason: string,
): SessionsState {
  const open = state.open;

  return open?.id === sessionId
    ? { ...state, open: { ...open, failure: reason, loading: false } }
    : state;
}

export type DeltaOutcome = {
  state: SessionsState;
  /** Турн кончился: буфер выброшен, записи надо дочитать с курсора. */
  reread: boolean;
};

/**
 * Дельта турна. Кадры рассылаются всем клиентам без фильтра, поэтому чужая сессия отсеивается
 * здесь: подписки на уровне протокола нет и не планируется (docs/web-api.md).
 */
export function applySessionDelta(
  state: SessionsState,
  sessionId: string,
  turnId: string,
  delta: SessionDelta,
): DeltaOutcome {
  const open = state.open;

  if (open?.id !== sessionId) {
    return { state, reread: false };
  }

  // Очереди про турн ничего не говорят: сообщение к следующему турну кладут и в простое, и
  // выбрасывать по нему буфер или снимать ожидающий текст было бы неверно.
  if (delta.kind === "queues") {
    return { state: applyQueues(state, sessionId, delta.queues), reread: false };
  }

  // `phase: queued` подтверждает только ожидание: записи реплики и живого буфера ещё нет. Любая
  // следующая дельта означает, что турн начался или закончился, и текст уже показывает другой слой.
  const pending =
    delta.kind === "phase" && delta.phase === "queued"
      ? open.pending
      : removePending(open.pending, turnId);

  if (delta.kind === "turn-end" || delta.kind === "turn-aborted" || delta.kind === "turn-failed") {
    return {
      state: {
        ...state,
        open: {
          ...open,
          pending,
          live: undefined,
          ...(delta.kind === "turn-failed" ? { failure: delta.reason } : {}),
        },
      },
      reread: true,
    };
  }

  // Фаза приезжает и дельтой, и снимком. Верим дельте: она быстрее, а снимок её же и подтвердит.
  if (delta.kind === "phase") {
    const summary = open.summary;

    return {
      state: {
        ...state,
        open: {
          ...open,
          pending,
          ...(summary === undefined ? {} : { summary: { ...summary, phase: delta.phase } }),
        },
      },
      reread: false,
    };
  }

  const live = open.live?.turnId === turnId ? open.live : { turnId, order: [], items: {} };

  return {
    state: { ...state, open: { ...open, pending, live: foldIntoTurn(live, delta) } },
    reread: false,
  };
}

function removePending(pending: Record<string, string>, turnId: string): Record<string, string> {
  if (!(turnId in pending)) {
    return pending;
  }

  return Object.fromEntries(Object.entries(pending).filter(([known]) => known !== turnId));
}

/**
 * Сообщение, к которому относится дельта. Дельта без начала — законный случай: клиент мог
 * подключиться посреди сообщения, и терять из-за этого его содержимое незачем.
 */
function startedMessage(turn: LiveTurn, messageId: string): StreamedMessage {
  const known = turn.items[messageId];

  return known?.kind === "message"
    ? known
    : {
        kind: "message",
        messageId,
        role: "agent",
        text: "",
        reasoning: "",
        images: [],
        done: false,
      };
}

function foldIntoTurn(turn: LiveTurn, delta: SessionDelta): LiveTurn {
  const put = (key: string, item: StreamedItem): LiveTurn => ({
    turnId: turn.turnId,
    order: turn.order.includes(key) ? turn.order : [...turn.order, key],
    items: { ...turn.items, [key]: item },
  });

  switch (delta.kind) {
    case "message-start":
      return put(delta.messageId, {
        kind: "message",
        messageId: delta.messageId,
        role: delta.role,
        text: "",
        reasoning: "",
        images: [],
        done: false,
      });

    case "message-delta": {
      const message = startedMessage(turn, delta.messageId);

      return put(delta.messageId, {
        ...message,
        ...(delta.channel === "text"
          ? { text: message.text + delta.text }
          : { reasoning: message.reasoning + delta.text }),
      });
    }

    case "message-images":
      return put(delta.messageId, {
        ...startedMessage(turn, delta.messageId),
        images: delta.images,
      });

    case "message-end": {
      const known = turn.items[delta.messageId];

      return known?.kind === "message" ? put(delta.messageId, { ...known, done: true }) : turn;
    }

    case "tool-start":
      return put(delta.toolCallId, {
        kind: "tool",
        toolCallId: delta.toolCallId,
        toolName: delta.toolName,
        input: delta.input,
        done: false,
      });

    case "tool-end": {
      const known = turn.items[delta.toolCallId];

      return known?.kind === "tool"
        ? put(delta.toolCallId, { ...known, failed: delta.failed, done: true })
        : turn;
    }

    default:
      return turn;
  }
}

export type StreamOutcome = {
  state: SessionsState;
  /** Перечитать список сессий и записи открытой. */
  sessions: boolean;
};

/**
 * События шины. Про сессии оно одно на всё — создание, смену фазы и удаление, — и означает
 * «спросить снимок заново» (docs/event-bus.md).
 */
export function applyStreamEvent(state: SessionsState, event: BusStreamEvent): StreamOutcome {
  if (isPluginStreamEvent(event)) {
    return { state, sessions: false };
  }

  if (event.type === streamGapType) {
    return { state, sessions: true };
  }

  // Утрата опоры — единственное событие сессий с нагрузкой: перечитать её неоткуда, состояния
  // «инструмент был и пропал» нигде не лежит (docs/event-bus.md).
  if (event.type === coreEventTypes.sessionDegraded) {
    const payload = event.payload as { sessionId: string; kind: "tool" | "model"; name: string };

    return {
      state: applyDegradation(state, payload.sessionId, {
        kind: payload.kind,
        name: payload.name,
      }),
      sessions: false,
    };
  }

  return { state, sessions: event.type === coreEventTypes.sessionsChanged };
}

/**
 * Поток поднялся заново. Буфер идущего турна обнуляется: его дельты не лежат ни в окне догона, ни
 * на шине. Записи перечитываются с нуля, а не с курсора — за время разрыва турн мог и кончиться,
 * и провалиться, и курсор указывает в середину того, чего мы не видели.
 */
export function reconnected(state: SessionsState): SessionsState {
  const open = state.open;

  if (open === undefined) {
    return state;
  }

  return {
    ...state,
    open: {
      ...open,
      entries: [],
      seen: 0,
      // Метки — свёртка прочитанных записей: обнулённая лента обнуляет и их, иначе метка снятой
      // записи пережила бы ленту, из которой она выведена.
      labels: new Map(),
      // За время разрыва лист мог переехать: спросить его заново дешевле, чем показывать прежний.
      leafId: undefined,
      branchEntryIds: new Set(),
      live: undefined,
      pending: {},
      // Очереди обнуляются вместе с буфером: их состояние приезжает дельтой, а дельты за время
      // разрыва потеряны. Верное значение приедет со следующим `queue_update`.
      queues: undefined,
      loading: true,
    },
  };
}

/** Идёт ли турн. Ответ даёт фаза снимка — дельты про турн из очереди не знают вовсе. */
export function isBusy(session: Session | undefined): boolean {
  return session !== undefined && session.phase !== "idle";
}
