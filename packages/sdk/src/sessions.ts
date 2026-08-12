/**
 * Сессии агента глазами плагина (docs/sessions-and-projects.md).
 *
 * **Веб-API и SDK отдают один и тот же набор.** Разные наборы для интерфейса и для плагинов — это
 * два контракта на одну сущность и гарантированный рассинхрон.
 *
 * Типы ниже — **своя копия** типов протокола, ровно как у провайдеров: SDK ставится извне и
 * внутренних пакетов не тянет. Копия обязана совпадать с протоколом до поля, и расхождение ловится
 * тождеством в мосте демона (`apps/daemon/src/plugin-sessions.ts`).
 */

import { currentPluginHost, type ThinkingLevel } from "./host.ts";

/**
 * Состояние сессии. Список наш, а не рантайма: фаза у него приватная, а `queued` он не знает вовсе
 * (docs/architecture.md).
 */
export type SessionPhase = "idle" | "queued" | "turn" | "compaction" | "branch-summary" | "retry";

export type Session = {
  id: string;
  /** Идентичность проекта для разрешения вкладов и принадлежности сессии. */
  projectId: string;
  /** Рабочий контекст рантайма и файловых инструментов; не заменяет идентичность проекта. */
  folder: string;
  agentId: string;
  agentAvailable: boolean;
  /** `<провайдер>/<модель>`. */
  model: string;
  thinkingLevel: ThinkingLevel;
  phase: SessionPhase;
  /** Имя, данное человеком. Его может не быть: сессия называется не при создании, а когда захочется. */
  title?: string;
  /** Архивная сессия убрана с глаз, но цела и читается по прямому адресу. */
  archived: boolean;
  createdAt: string;
};

/** Что человек вправе приложить к сообщению. Список закрыт, как и в протоколе. */
export type SessionImageMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type SessionContentBlock =
  | { kind: "text"; text: string }
  /** Изображение внутри сообщения. `data` — чистый base64 без `data:` prefix. */
  | { kind: "image"; mimeType: SessionImageMimeType; data: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; toolCallId: string; toolName: string; input: unknown };

/**
 * Запись дерева сессии. Разобраны все одиннадцать типов записей рантайма; `other` остаётся под то,
 * чего рантайм ещё не умеет — новый тип записи обязан доехать до плагина хоть чем-то.
 */
export type SessionEntry = {
  id: string;
  parentId?: string;
  time: string;
} & (
  | { kind: "message"; role: "user" | "agent"; content: SessionContentBlock[] }
  | { kind: "tool-result"; toolCallId: string; toolName: string; text: string; failed: boolean }
  | { kind: "model-change"; model: string }
  | { kind: "thinking-level-change"; thinkingLevel: ThinkingLevel }
  | { kind: "tools-change"; toolNames: string[] }
  /**
   * Контекст свёрнут в пересказ. `firstKeptEntryId` — с какой записи хвост оставлен как есть;
   * `fromHook` различает пересказ рантайма и подсунутый платформой, а она подсовывает свой всегда.
   */
  | {
      kind: "compaction";
      summary: string;
      tokensBefore: number;
      firstKeptEntryId?: string;
      fromHook: boolean;
    }
  /** Пересказ покинутой ветки, записанный при переходе к другой записи дерева. */
  | { kind: "branch-summary"; fromId: string; summary: string; fromHook: boolean }
  /** Метка на записи. Отсутствие `label` — снятая метка: действующее значение это свёртка записей. */
  | { kind: "label"; targetId: string; label?: string }
  /** Сессию назвали. Отсутствие `name` — имя сняли. */
  | { kind: "session-name"; name?: string }
  /** Лист дерева переставлен. Отсутствие `targetId` — дерево вернули в пустое состояние. */
  | { kind: "leaf"; targetId?: string }
  /** Запись приложения, модели не показанная. */
  | { kind: "custom"; type: string; data?: unknown }
  /** Запись приложения, которая **является** сообщением в разговоре. */
  | { kind: "custom-message"; type: string; text: string; display: boolean }
  | { kind: "other"; type: string }
);

/**
 * Действующие метки ветки: свёртка записей `label` по цели. Считается здесь, чтобы каждый плагин не
 * повторял свёртку и не расходился с соседом в том, что значит метка, снятая и поставленная заново.
 */
export function foldEntryLabels(entries: readonly SessionEntry[]): Map<string, string> {
  const labels = new Map<string, string>();

  for (const entry of entries) {
    if (entry.kind !== "label") {
      continue;
    }

    if (entry.label === undefined) {
      labels.delete(entry.targetId);
    } else {
      labels.set(entry.targetId, entry.label);
    }
  }

  return labels;
}

export type SessionEntriesPage = {
  sessionId: string;
  entries: SessionEntry[];
  /** Значение курсора для следующего запроса. */
  seen: number;
};

/** Нормализованный selector в ответе ядра; в отличие от SDK-объявления оба списка уже существуют. */
export type NormalizedAgentSkillSelection = {
  include: string[];
  exclude: string[];
};

type AgentSummaryCommon = {
  id: string;
  title?: string;
  description?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  skills: NormalizedAgentSkillSelection;
};

/** Копия `PluginSource` из протокола: SDK не тянет внутренний пакет. */
export type AgentPluginSource = "builtin" | "data" | `project:${string}`;

export type AgentSummary = AgentSummaryCommon &
  (
    | {
        ownership: "plugin";
        pluginKey: string;
        source: AgentPluginSource;
      }
    | {
        ownership: "standalone";
        pluginKey?: never;
        source: string;
        scope: "user" | "project";
        projectId?: string;
      }
  );

export type SessionDraft = {
  projectId: string;
  agentId: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

export type TurnRequest = {
  sessionId: string;
  text: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

export type TurnAccepted = {
  sessionId: string;
  turnId: string;
  phase: SessionPhase;
};

/** Тело изменения: переименование, архивация и восстановление — одна запись целой записи. */
export type SessionUpdate = {
  title?: string;
  archived: boolean;
};

/**
 * Где резать при форке. `before` — умолчание — оставляет всё до записи и работает только по
 * сообщению человека; `at` берёт путь до любой записи включительно.
 */
export type SessionForkRequest = {
  entryId?: string;
  position?: "before" | "at";
};

/**
 * Куда встаёт сообщение, отправленное не турном: вклинить в идущий турн, продолжить им же после
 * текущего, лечь в начало следующего или просто дописать в дерево.
 */
export type SessionMessageMode = "steer" | "follow-up" | "next-turn" | "append";

export type SessionMessage = {
  text: string;
  mode: SessionMessageMode;
};

export type SessionMessageAccepted = {
  sessionId: string;
  mode: SessionMessageMode;
};

/** Счёт по всему файлу сессии, включая брошенные ветки. */
export type SessionStats = {
  sessionId: string;
  messageCount: number;
  cachedTokens: number;
  uncachedTokens: number;
  totalTokens: number;
  costTotal: number;
};

/**
 * Ветка дерева: путь от записи вверх до корня, в хронологическом порядке. `leafId` — лист
 * **сессии**, а не конец возвращённой ветки: по нему видно, в какой ветке сессия сейчас работает.
 */
export type SessionBranch = {
  sessionId: string;
  entries: SessionEntry[];
  leafId?: string;
};

/**
 * Насколько заполнен контекст. Считается по действующей ветке, а не по файлу целиком: `SessionStats`
 * отвечает «сколько заплачено», эта — «сколько ещё влезет». Окна может не быть, если модель
 * недоступна, — тогда доли не существует.
 */
export type SessionContextUsage = {
  sessionId: string;
  tokens: number;
  contextWindow?: number;
  /** Доля окна, после которой компакция запускается сама. `0` — автопорог выключен. */
  threshold: number;
};

/** Тело компакции. Инструкции необязательны: без них рантайм пересказывает по своему промпту. */
export type SessionCompactRequest = {
  instructions?: string;
};

/** Ответ на запуск компакции. Фаза здесь та же, что у турна: компакция ждёт своей очереди. */
export type SessionCompactAccepted = {
  sessionId: string;
  phase: SessionPhase;
};

/**
 * Тело перехода к записи дерева. `summarize` заказывает пересказ покидаемой ветки — это запрос к
 * модели. `replaceInstructions` заменяет промпт пересказа целиком, а не дописывает к нему.
 */
export type SessionNavigateRequest = {
  entryId: string;
  summarize?: boolean;
  instructions?: string;
  replaceInstructions?: boolean;
};

/**
 * Ответ перехода. `editorText` появляется, когда целью была реплика человека: листом в этом случае
 * становится её родитель, а текст возвращается, чтобы вопрос можно было задать иначе.
 */
export type SessionNavigated = {
  sessionId: string;
  leafId?: string;
  editorText?: string;
  summarized: boolean;
};

/** Тело простановки метки. `null` снимает метку. */
export type SessionLabelUpdate = {
  label: string | null;
};

/** Ответ простановки метки. Без `label` — метка снята. */
export type SessionEntryLabelled = {
  sessionId: string;
  entryId: string;
  label?: string;
};

/**
 * Отказ подписчика, увиденный со стороны вызывающего. Форма не та, которой отказывает обработчик
 * (`HookRefusal`): отказавшему незачем называть себя, а тому, кто получил отказ, автор нужен —
 * подписок у плагина несколько, и выключать придётся конкретную (docs/hooks.md).
 */
export type SessionRefusedByHook = {
  /** Идентификатор вклада, а не плагина: тот же, которым вклад включается и выключается. */
  contributionId: string;
  /** Текст плагина, попадает в интерфейс как есть. Таймаут приходит отказом этой же формы. */
  reason: string;
};

/**
 * Исход создания сессии. Объединение, а не сессия с исключением: запрет подписчиком означает, что
 * система работает как задумано, и разбирать оба случая заставляет тип (docs/hooks.md). Сбои —
 * недоступный проект, занятая сессия, упавшая запись — по-прежнему исключения.
 */
export type SessionCreateOutcome =
  | { kind: "created"; session: Session }
  /** Отказов может быть несколько: опрашиваются все подписчики, и в исходе лежит список. */
  | { kind: "refused"; refusals: SessionRefusedByHook[] };

export type SessionRequest =
  | { kind: "agent-list" }
  | { kind: "session-list"; projectId?: string; archived?: boolean }
  | { kind: "session-create"; draft: SessionDraft }
  | { kind: "session-entries"; sessionId: string; after?: number }
  | { kind: "session-prompt"; turn: TurnRequest }
  | { kind: "session-abort"; sessionId: string }
  | { kind: "session-fork"; sessionId: string; request: SessionForkRequest }
  | { kind: "session-update"; sessionId: string; update: SessionUpdate }
  | { kind: "session-remove"; sessionId: string }
  | { kind: "session-message"; sessionId: string; message: SessionMessage }
  | { kind: "session-stats"; sessionId: string }
  | { kind: "session-branch"; sessionId: string; from?: string }
  | { kind: "session-context"; sessionId: string }
  | { kind: "session-compact"; sessionId: string; request: SessionCompactRequest }
  | { kind: "session-navigate"; sessionId: string; request: SessionNavigateRequest }
  | { kind: "session-label"; sessionId: string; entryId: string; update: SessionLabelUpdate };

export type SessionResponse =
  | { kind: "agent-list"; agents: AgentSummary[] }
  | { kind: "session-list"; sessions: Session[] }
  | { kind: "session-create"; outcome: SessionCreateOutcome }
  | { kind: "session-entries"; page: SessionEntriesPage }
  | { kind: "session-prompt"; accepted: TurnAccepted }
  | { kind: "session-abort"; interrupted: boolean }
  | { kind: "session-fork"; session: Session }
  | { kind: "session-update"; session: Session }
  | { kind: "session-remove" }
  | { kind: "session-message"; accepted: SessionMessageAccepted }
  | { kind: "session-stats"; stats: SessionStats }
  | { kind: "session-branch"; branch: SessionBranch }
  | { kind: "session-context"; usage: SessionContextUsage }
  | { kind: "session-compact"; accepted: SessionCompactAccepted }
  | { kind: "session-navigate"; navigated: SessionNavigated }
  | { kind: "session-label"; labelled: SessionEntryLabelled }
  /** Отказ платформы: проект архивный, агента нет, модель недоступна, сессия занята. */
  | { kind: "failed"; reason: string };

async function ask<Kind extends SessionResponse["kind"]>(
  request: SessionRequest,
  expected: Kind,
): Promise<Extract<SessionResponse, { kind: Kind }>> {
  const response = await currentPluginHost().sessions(request);

  if (response.kind === "failed") {
    throw new Error(response.reason);
  }

  if (response.kind !== expected) {
    throw new Error(`the platform answered ${response.kind} to a ${expected} request`);
  }

  return response as Extract<SessionResponse, { kind: Kind }>;
}

export const sessions = {
  /** Включённые агенты. Пустой список — законный ответ, а не ошибка. */
  agents: async (): Promise<AgentSummary[]> =>
    (await ask({ kind: "agent-list" }, "agent-list")).agents,

  /** Сессии, при желании — только одного проекта; `archived` переключает список на архивные. */
  list: async (projectId?: string, archived = false): Promise<Session[]> =>
    (
      await ask(
        {
          kind: "session-list",
          ...(projectId === undefined ? {} : { projectId }),
          ...(archived ? { archived: true } : {}),
        },
        "session-list",
      )
    ).sessions,

  /**
   * Создать сессию. Она живёт в ядре: выгрузка плагина, который её создал, сессию не останавливает
   * (docs/architecture.md).
   *
   * Возвращает исход, а не сессию: подписчик на `before_session_start` вправе отказать, и отказ —
   * это значение (docs/hooks.md).
   */
  create: async (draft: SessionDraft): Promise<SessionCreateOutcome> =>
    (await ask({ kind: "session-create", draft }, "session-create")).outcome,

  /**
   * Запустить турн. Возврат не значит «турн кончился»: он значит «принят». При исчерпанном пределе
   * одновременных турнов `phase` равна `queued`.
   */
  prompt: async (turn: TurnRequest): Promise<TurnAccepted> =>
    (await ask({ kind: "session-prompt", turn }, "session-prompt")).accepted,

  /** Прервать турн. `false` — прерывать было нечего, и это не ошибка. */
  abort: async (sessionId: string): Promise<boolean> =>
    (await ask({ kind: "session-abort", sessionId }, "session-abort")).interrupted,

  /** Записи дерева сессии, курсором. */
  entries: async (sessionId: string, after?: number): Promise<SessionEntriesPage> =>
    (
      await ask(
        after === undefined
          ? { kind: "session-entries", sessionId }
          : { kind: "session-entries", sessionId, after },
        "session-entries",
      )
    ).page,

  /**
   * Новая сессия из куска этой. Без `entryId` форк берёт сессию целиком; форк остаётся в том же
   * проекте и рождается действующим, даже если источник архивный.
   */
  fork: async (sessionId: string, request: SessionForkRequest = {}): Promise<Session> =>
    (await ask({ kind: "session-fork", sessionId, request }, "session-fork")).session,

  /**
   * Переименовать, заархивировать или восстановить. Тело заменяет запись целиком: `archived`
   * обязателен, а тело без `title` снимает имя. Архивация требует простоя, переименование — нет.
   */
  update: async (sessionId: string, update: SessionUpdate): Promise<Session> =>
    (await ask({ kind: "session-update", sessionId, update }, "session-update")).session,

  /** Удалить сессию безвозвратно. Требует простоя; форки этой сессии остаются жить. */
  remove: async (sessionId: string): Promise<void> => {
    await ask({ kind: "session-remove", sessionId }, "session-remove");
  },

  /** Сообщение, которое не запускает турн: стиринг, догоняющее, к следующему турну, дозапись. */
  message: async (sessionId: string, message: SessionMessage): Promise<SessionMessageAccepted> =>
    (await ask({ kind: "session-message", sessionId, message }, "session-message")).accepted,

  /** Токены и стоимость по всему файлу сессии. */
  stats: async (sessionId: string): Promise<SessionStats> =>
    (await ask({ kind: "session-stats", sessionId }, "session-stats")).stats,

  /**
   * Ветка дерева: путь от записи вверх до корня или до последней компакции. Без `from` — ветка от
   * текущего листа, то есть тот разговор, который увидит модель на следующем турне.
   */
  branch: async (sessionId: string, from?: string): Promise<SessionBranch> =>
    (
      await ask(
        from === undefined
          ? { kind: "session-branch", sessionId }
          : { kind: "session-branch", sessionId, from },
        "session-branch",
      )
    ).branch,

  /** Насколько заполнен контекст и с какой доли окна компакция запускается сама. */
  context: async (sessionId: string): Promise<SessionContextUsage> =>
    (await ask({ kind: "session-context", sessionId }, "session-context")).usage,

  /**
   * Свернуть контекст в пересказ. Возврат значит «принята», а не «свёрнута»: компакция ходит к
   * модели и ждёт своей очереди наравне с турном.
   */
  compact: async (
    sessionId: string,
    request: SessionCompactRequest = {},
  ): Promise<SessionCompactAccepted> =>
    (await ask({ kind: "session-compact", sessionId, request }, "session-compact")).accepted,

  /**
   * Перейти к записи дерева, при желании пересказав покидаемую ветку. В отличие от компакции ждёт
   * результата: `editorText` доставить вне ответа нечем.
   */
  navigate: async (sessionId: string, request: SessionNavigateRequest): Promise<SessionNavigated> =>
    (await ask({ kind: "session-navigate", sessionId, request }, "session-navigate")).navigated,

  /** Поставить или снять метку записи. `null` снимает: «не трогать» здесь не операция. */
  label: async (
    sessionId: string,
    entryId: string,
    update: SessionLabelUpdate,
  ): Promise<SessionEntryLabelled> =>
    (await ask({ kind: "session-label", sessionId, entryId, update }, "session-label")).labelled,
};
