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
  projectId: string;
  folder: string;
  agentId: string;
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

export type SessionContentBlock =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; toolCallId: string; toolName: string; input: unknown };

/** Запись, которую платформа не переводит, приезжает как `other` со своим типом рантайма. */
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
  | { kind: "other"; type: string }
);

export type SessionEntriesPage = {
  sessionId: string;
  entries: SessionEntry[];
  /** Значение курсора для следующего запроса. */
  seen: number;
};

export type AgentSummary = {
  id: string;
  title?: string;
  description?: string;
  pluginKey: string;
  source: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  skills: string[];
};

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

export type SessionRequest =
  | { kind: "agent-list" }
  | { kind: "session-list"; projectId?: string }
  | { kind: "session-create"; draft: SessionDraft }
  | { kind: "session-entries"; sessionId: string; after?: number }
  | { kind: "session-prompt"; turn: TurnRequest }
  | { kind: "session-abort"; sessionId: string }
  | { kind: "session-fork"; sessionId: string; request: SessionForkRequest }
  | { kind: "session-update"; sessionId: string; update: SessionUpdate }
  | { kind: "session-remove"; sessionId: string }
  | { kind: "session-message"; sessionId: string; message: SessionMessage }
  | { kind: "session-stats"; sessionId: string };

export type SessionResponse =
  | { kind: "agent-list"; agents: AgentSummary[] }
  | { kind: "session-list"; sessions: Session[] }
  | { kind: "session-create"; session: Session }
  | { kind: "session-entries"; page: SessionEntriesPage }
  | { kind: "session-prompt"; accepted: TurnAccepted }
  | { kind: "session-abort"; interrupted: boolean }
  | { kind: "session-fork"; session: Session }
  | { kind: "session-update"; session: Session }
  | { kind: "session-remove" }
  | { kind: "session-message"; accepted: SessionMessageAccepted }
  | { kind: "session-stats"; stats: SessionStats }
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

  /** Сессии, при желании — только одного проекта. Архивные в список не попадают. */
  list: async (projectId?: string): Promise<Session[]> =>
    (
      await ask(
        projectId === undefined ? { kind: "session-list" } : { kind: "session-list", projectId },
        "session-list",
      )
    ).sessions,

  /**
   * Создать сессию. Она живёт в ядре: выгрузка плагина, который её создал, сессию не останавливает
   * (docs/architecture.md).
   */
  create: async (draft: SessionDraft): Promise<Session> =>
    (await ask({ kind: "session-create", draft }, "session-create")).session,

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
};
