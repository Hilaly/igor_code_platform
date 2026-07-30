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
  isPluginStreamEvent,
  streamGapType,
  type AgentSummary,
  type BusStreamEvent,
  type ModelSummary,
  type Project,
  type ProviderSummary,
  type Session,
  type SessionDelta,
  type SessionEntry,
  type SessionsSnapshot,
} from "@sovereign/protocol";

/** Сообщение, которое ещё едет. Каналы разделены: размышления показываются свёрнутыми отдельно. */
export type StreamedMessage = {
  kind: "message";
  messageId: string;
  role: "user" | "agent";
  text: string;
  reasoning: string;
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
   * Текст отправленного турна до его первой дельты. Турн в очереди дельт не даёт, и без этого
   * реплика человека появлялась бы в ленте только когда очередь до неё дойдёт.
   */
  pending: Record<string, string>;
  /** Причина `turn-failed` или отказа демона. Английская фраза уходит ещё и в диагностику. */
  failure?: string;
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
};

export const initialSessionsState: SessionsState = { problems: [], models: {} };

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

  return {
    ...state,
    open: { ...open, summary, ...(summary === undefined ? { loading: false } : {}) },
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
      pending: {},
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

  return {
    ...state,
    open: { ...open, entries: [...open.entries, ...entries], seen, loading: false },
  };
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

  // Первая дельта турна снимает его текст из ожидающих: дальше реплику показывают записи и буфер.
  const pending = removePending(open.pending, turnId);

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
        done: false,
      });

    case "message-delta": {
      const known = turn.items[delta.messageId];
      // Дельта без начала — законный случай: клиент мог подключиться посреди сообщения.
      const message: StreamedMessage =
        known?.kind === "message"
          ? known
          : {
              kind: "message",
              messageId: delta.messageId,
              role: "agent",
              text: "",
              reasoning: "",
              done: false,
            };

      return put(delta.messageId, {
        ...message,
        ...(delta.channel === "text"
          ? { text: message.text + delta.text }
          : { reasoning: message.reasoning + delta.text }),
      });
    }

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
    open: { ...open, entries: [], seen: 0, live: undefined, pending: {}, loading: true },
  };
}

/** Идёт ли турн. Ответ даёт фаза снимка — дельты про турн из очереди не знают вовсе. */
export function isBusy(session: Session | undefined): boolean {
  return session !== undefined && session.phase !== "idle";
}
