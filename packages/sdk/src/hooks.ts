/**
 * Хуки: точки, в которых плагин вклинивается в работу агента (docs/hooks.md).
 *
 * **Единственное место вне `packages/agent-runtime-pi`, где импорт `@earendil-works/*` разрешён.**
 * Исключение названо в docs/hooks.md и объявлено в `eslint.config.js`; здесь оно ограничено
 * реэкспортом **типов**. Исполняемый код Pi по-прежнему живёт только в пакете реализации
 * (docs/architecture.md).
 *
 * Своих зеркальных типов для событий рантайма мы не заводим: имя, нагрузка и возвращаемое значение
 * берутся у Pi без переименования. Цена решения названа в docs/hooks.md — контракт Pi становится
 * частью нашего публичного контракта.
 *
 * У десяти событий цикла агента именованных интерфейсов у Pi нет. Отдельное событие адресуется
 * `Extract<AgentEvent, { type: "message_update" }>`; зеркала для них мы не пишем по тому же правилу.
 */

import type { AgentHarnessEvent, AgentHarnessEventResultMap } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

export type {
  AgentEvent,
  AgentHarnessEvent,
  AgentHarnessEventResultMap,
  AgentHarnessOwnEvent,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  AgentHarnessStreamOptionsPatch,
  AgentMessage,
  BranchSummaryEntry,
  CompactionEntry,
  CompactionPreparation,
  CompactResult,
  PromptTemplate,
  SessionTreeEntry,
  Skill,
} from "@earendil-works/pi-agent-core";

/** Двадцать два события harness. У десяти событий цикла агента отдельных интерфейсов нет. */
export type {
  AbortEvent,
  AfterProviderResponseEvent,
  BeforeAgentStartEvent,
  BeforeProviderPayloadEvent,
  BeforeProviderRequestEvent,
  ContextEvent,
  ModelUpdateEvent,
  QueueUpdateEvent,
  ResourcesUpdateEvent,
  RetryAttemptStartEvent,
  RetryFinishedEvent,
  RetryScheduledEvent,
  SavePointEvent,
  SessionBeforeCompactEvent,
  SessionBeforeTreeEvent,
  SessionCompactEvent,
  SessionTreeEvent,
  SettledEvent,
  ThinkingLevelUpdateEvent,
  ToolCallEvent,
  ToolResultEvent,
  ToolsUpdateEvent,
} from "@earendil-works/pi-agent-core";

/** Возвращаемые значения восьми перехватывающих событий. */
export type {
  BeforeAgentStartResult,
  BeforeProviderPayloadResult,
  BeforeProviderRequestResult,
  ContextResult,
  SessionBeforeCompactResult,
  SessionBeforeTreeResult,
  ToolCallResult,
  ToolResultPatch,
} from "@earendil-works/pi-agent-core";

/** `usage` берётся у рантайма: собственного отчёта о трате мы не заводим (docs/hooks.md). */
export type { Usage } from "@earendil-works/pi-ai";
export type { ImageContent, Model, TextContent } from "@earendil-works/pi-ai";

/** Имена всех 32 событий рантайма. */
export type RuntimeHookName = AgentHarnessEvent["type"];

/**
 * Нагрузка события рантайма, как её видит плагин: тип Pi без `signal`. Сигнал отмены — единственное,
 * что не переживает границу воркера: структурное клонирование `AbortSignal` не умеет. Поле убрано
 * `Omit`, а не переописано — имена и формы остальных полей остаются пиевскими.
 */
export type RuntimeHookPayload<Name extends RuntimeHookName> = Omit<
  Extract<AgentHarnessEvent, { type: Name }>,
  "signal"
>;

/** Что ждёт Pi в ответ. У 24 наблюдательных событий — ничего. */
export type RuntimeHookResult<Name extends RuntimeHookName> =
  Name extends keyof AgentHarnessEventResultMap ? AgentHarnessEventResultMap[Name] : undefined;

/**
 * Отказ решающего хука. Разрешение — это **отсутствие** отказа, а не чей-то голос «за»
 * (docs/hooks.md); поэтому обработчик, которому нечего сказать, не возвращает ничего.
 */
export type HookRefusal = { refuse: string };

/**
 * Хуки платформы: пять точек, которых в Pi нет по определению (docs/hooks.md). Имён пять, а не
 * шесть: собирающий `tools_collect` подписке не отдаётся — инструмент плагина объявляется вкладом
 * (`contribute.tool`), и второго способа добавить инструмент у платформы нет.
 */
export type PlatformHookPayloadMap = {
  session_created: { sessionId: string; projectId: string; agentId: string };
  session_closed: { sessionId: string; projectId: string };
  /** До первой траты: отказ здесь означает, что сессия не создана вовсе. */
  before_session_start: { projectId: string; folder: string; agentId: string };
  /** Сумма по всем запросам турна, включая повторы и вызовы инструментов (docs/hooks.md). */
  turn_finished: { sessionId: string; projectId: string; usage: Usage };
  /**
   * Разрешение на вызов инструмента. Своя нагрузка, а не `tool_call` Pi: у события Pi нет ни
   * сессии, ни проекта. Диалог с человеком ядро не проксирует — его делает плагин.
   */
  permission_request: {
    sessionId: string;
    projectId: string;
    folder: string;
    tool: string;
    arguments: unknown;
  };
};

export type PlatformHookName = keyof PlatformHookPayloadMap;

export type PlatformHookResultMap = {
  session_created: undefined;
  session_closed: undefined;
  before_session_start: HookRefusal | undefined;
  turn_finished: undefined;
  permission_request: HookRefusal | undefined;
};

export type HookName = RuntimeHookName | PlatformHookName;

export type HookPayload<Name extends HookName> = Name extends PlatformHookName
  ? PlatformHookPayloadMap[Name]
  : Name extends RuntimeHookName
    ? RuntimeHookPayload<Name>
    : never;

export type HookResult<Name extends HookName> = Name extends PlatformHookName
  ? PlatformHookResultMap[Name]
  : Name extends RuntimeHookName
    ? RuntimeHookResult<Name>
    : never;

/**
 * Обработчик подписки. `void` в возвращаемом типе — это «мне нечего добавить»: у перезаписывающего
 * хука отказ от изменения означает вернуть ничего, отдельного способа сказать «я ничего не меняю»
 * нет (docs/hooks.md).
 */
export type HookHandler<Name extends HookName> = (
  payload: HookPayload<Name>,
) => HookResult<Name> | void | Promise<HookResult<Name> | void>;

/**
 * Таблица обработчиков живёт на символе в `globalThis` по той же причине, что таблица подписок на
 * события: у внешнего плагина в `node_modules` своя копия пакета
 * ([runtime-checks.md](../../../docs/runtime-checks.md), проверка 15).
 */
const handlersSymbol = Symbol.for("sovereign.plugin.hook.handlers");

type AnyHookHandler = (payload: never) => unknown;

function handlers(): Map<string, AnyHookHandler> {
  const existing = (globalThis as Record<symbol, unknown>)[handlersSymbol];

  if (existing !== undefined) {
    return existing as Map<string, AnyHookHandler>;
  }

  const created = new Map<string, AnyHookHandler>();
  (globalThis as Record<symbol, unknown>)[handlersSymbol] = created;

  return created;
}

/** Нужно тестовому шву: следующий тест начинается с чистой таблицы. */
export function clearHookHandlers(): void {
  delete (globalThis as Record<symbol, unknown>)[handlersSymbol];
}

/** Обработчик остаётся в воркере: ядру уходит только объявление подписки (docs/hooks.md). */
export function rememberHookHandler(declaredId: string, handler: AnyHookHandler): void {
  handlers().set(declaredId, handler);
}

/**
 * Точка входа вызова: её зовёт бутстрап воркера, получив `call` от ядра. Автору плагина она не
 * нужна. Исключение обработчика наружу не выпускается — оно уезжает отказом-сбоем, потому что до Pi
 * доходить ему нельзя: там оно роняет турн (docs/hooks.md).
 */
export async function invokeHookHandler(declaredId: string, payload: unknown): Promise<unknown> {
  const handler = handlers().get(declaredId);

  if (handler === undefined) {
    throw new Error(`the plugin has no handler for the hook subscription ${declaredId}`);
  }

  return handler(payload as never);
}
