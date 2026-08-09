/**
 * Поверхность плагина: то, что он импортирует (docs/plugins.md). Имена импортов — публичный контракт,
 * менять их дороже, чем внутренности.
 *
 * Всё асинхронно (docs/plugins.md): плагин живёт в своём воркере, и любой вызов к платформе — сообщение.
 */

import { z } from "zod";

import { subscribeToEvent } from "./events.ts";
import {
  currentPluginHost,
  type AgentContribution,
  type ColorSchemeContribution,
  type CommandContribution,
  type ComponentContribution,
  type CustomContribution,
  type HookCriticality,
  type LocaleCatalogContribution,
  type PlaceContribution,
  type PluginLogLevel,
  type RouteContribution,
} from "./host.ts";
import { rememberHookHandler, type HookHandler, type HookName } from "./hooks.ts";
import { rememberRouteHandler, type PluginRouteHandler } from "./routes.ts";
import { rememberToolInvoke, type PluginToolInvoke } from "./tools.ts";

export type { EventHandler, EventOrigin, Unsubscribe } from "./events.ts";

export { hookCriticalities, placeCardinalities, thinkingLevels } from "./host.ts";

export type {
  AgentContribution,
  AgentSkillSelection,
  AgentToolSelection,
  ColorSchemeContribution,
  ColorSchemeDocument,
  CommandContribution,
  ComponentContribution,
  CustomContribution,
  EventContribution,
  HookContribution,
  HookCriticality,
  LocaleCatalogContribution,
  PayloadSchema,
  PlaceCardinality,
  PlaceContribution,
  PluginContribution,
  PluginHost,
  PluginIdentity,
  PluginLogLevel,
  RouteContribution,
  ThinkingLevel,
  ToolContribution,
} from "./host.ts";

/**
 * Хуки: типы событий Pi как есть плюс пять хуков платформы (docs/hooks.md). Отдельной точкой входа
 * `@sovereign/sdk/hooks` тоже: автор, которому нужны только типы события, не тянет весь остальной
 * контракт.
 */
export type {
  HookHandler,
  HookName,
  HookPayload,
  HookRefusal,
  HookResult,
  PlatformHookName,
  RuntimeHookName,
  RuntimeHookPayload,
  RuntimeHookResult,
} from "./hooks.ts";

export type { PluginToolInvoke, PluginToolOutcome } from "./tools.ts";

/**
 * HTTP-маршруты плагина (docs/web-api.md). Публичный маршрут открыт наружу и аутентифицирует себя
 * сам — это единственная поверхность платформы без проверки сессии.
 */
export { pluginRouteMethods } from "./routes.ts";

export type {
  PluginRouteBody,
  PluginRouteHandler,
  PluginRouteKind,
  PluginRouteMethod,
  PluginRouteRequest,
  PluginRouteResponse,
} from "./routes.ts";

/** Хранилище плагина: ключ-значение и своя папка (docs/plugins.md). */
export { storage } from "./storage.ts";

export type { StorageRequest, StorageResponse } from "./storage.ts";

/** Провайдеры LLM: операции над ними и типы, которыми платформа о них рассказывает. */
export { providers } from "./providers.ts";

/** Сессии агента: тот же набор, что у веб-API (docs/sessions-and-projects.md). */
export { foldEntryLabels, sessions } from "./sessions.ts";

export type {
  AgentPluginSource,
  AgentSummary,
  NormalizedAgentSkillSelection,
  Session,
  SessionBranch,
  SessionCompactAccepted,
  SessionCompactRequest,
  SessionContentBlock,
  SessionContextUsage,
  SessionCreateOutcome,
  SessionDraft,
  SessionEntriesPage,
  SessionEntry,
  SessionEntryLabelled,
  SessionForkRequest,
  SessionLabelUpdate,
  SessionMessage,
  SessionMessageAccepted,
  SessionMessageMode,
  SessionNavigated,
  SessionNavigateRequest,
  SessionPhase,
  SessionRefusedByHook,
  SessionRequest,
  SessionResponse,
  SessionStats,
  SessionUpdate,
  TurnAccepted,
  TurnRequest,
} from "./sessions.ts";

export type {
  CustomModelDefinition,
  CustomProviderApi,
  CustomProviderDefinition,
  LoginConclusion,
  LoginDialogue,
  LoginInput,
  LoginLink,
  LoginNotice,
  LoginOption,
  LoginPrompt,
  LoginStep,
  ModelCost,
  ModelSummary,
  ProviderAuthState,
  ProviderAuthType,
  ProviderLoginMethod,
  ProviderRequest,
  ProviderResponse,
  ProviderSummary,
  RefreshOutcome,
  RefreshReport,
} from "./providers.ts";

/**
 * Язык схем платформы (docs/event-bus.md). Реэкспорт, а не «поставьте zod сами»: два экземпляра zod в одном
 * процессе дают два несовместимых типа схемы, и схема плагина перестала бы подходить платформе.
 */
export { z };

/**
 * Точки входа плагина. `activate` вызывается после того, как хост готов; `deactivate` — перед
 * выгрузкой, и у него есть только ограниченное время (супервизор не ждёт вечно).
 */
export type PluginModule = {
  activate: () => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

type LogCall = (message: string, fields?: Record<string, unknown>) => Promise<void>;

// Асинхронно и на отсутствии хоста тоже: синхронный бросок из функции, возвращающей обещание,
// прилетел бы автору мимо `catch` вокруг `await`.
const at =
  (level: PluginLogLevel): LogCall =>
  async (message, fields) =>
    currentPluginHost().log(level, message, fields);

/** Источник записи проставляет ядро, а не плагин: подделать чужой нечем (docs/logging.md). */
export const log: Record<PluginLogLevel, LogCall> = {
  debug: at("debug"),
  info: at("info"),
  warn: at("warn"),
  error: at("error"),
};

/**
 * Событие плагина: имя, схема нагрузки и способ его опубликовать (docs/event-bus.md).
 *
 * Дескриптор — обычный экспорт модуля, и это главное в нём: подписчик импортирует его у
 * публикатора и получает и типы, и возможность проверить нагрузку у себя. Схема между воркерами не
 * ходит, а исходники — ходят.
 */
export type EventDescriptor<Schema extends z.ZodType = z.ZodType> = {
  /** Объявленный, без неймспейса: неймспейс ставит хост по идентичности плагина. */
  id: string;
  schema: Schema;
  publish: (payload: z.input<Schema>) => Promise<void>;
};

export function defineEvent<Schema extends z.ZodType>(
  id: string,
  schema: Schema,
): EventDescriptor<Schema> {
  return {
    id,
    schema,
    publish: async (payload) => {
      const checked = schema.safeParse(payload);

      // Отказ здесь, у того, кто ошибся, и до отправки: ядро схемы не знает и молча донесло бы
      // несоответствие до подписчика (docs/event-bus.md).
      if (!checked.success) {
        throw new Error(
          `the payload of the event ${id} does not match its schema: ${describeSchemaError(checked.error)}`,
        );
      }

      await currentPluginHost().publishEvent(id, checked.data);
    },
  };
}

export const contribute = {
  /**
   * Общий вид вклада (docs/plugins.md). Регистрация во время `activate` применяется одним снимком:
   * наблюдатель видит либо прежний набор, либо новый целиком.
   */
  custom: async (contribution: CustomContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "custom", ...contribution }),

  /**
   * Объявить событие. Пока оно не объявлено, публикация отказывается ядром: событие — это вклад, а
   * значит его видно в реестре и его можно выключить (docs/plugins.md, docs/event-bus.md).
   */
  event: async <Schema extends z.ZodType>(event: EventDescriptor<Schema>): Promise<void> =>
    currentPluginHost().contribute({
      kind: "event",
      id: event.id,
      payloadSchema: { ...z.toJSONSchema(event.schema) },
    }),

  /**
   * Объявить агента. Умолчаний SDK не подставляет — ни модели, ни пустых списков: их ставит ядро,
   * и подстановка здесь означала бы два места, где решается, что значит «не сказано».
   */
  agent: async (agent: AgentContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "agent", ...agent }),

  /**
   * Подписаться на хук (docs/hooks.md). Обработчик остаётся в воркере, ядру уходит объявление: имя
   * события, критичность и идентификатор вклада, которым подписка включается и выключается.
   *
   * Порядок подписка не объявляет: он считается по рангу источника плагина, затем по
   * идентификатору вклада. Число, которое автор назначал бы себе сам, превратилось бы в гонку.
   */
  hook: async <Name extends HookName>(subscription: {
    id: string;
    title?: string;
    description?: string;
    event: Name;
    criticality?: HookCriticality;
    handler: HookHandler<Name>;
  }): Promise<void> => {
    const { handler, ...declaration } = subscription;

    // Обработчик запоминается до объявления: ядро вправе позвать хук сразу, как узнало о подписке.
    rememberHookHandler(declaration.id, handler as (payload: never) => unknown);

    await currentPluginHost().contribute({ kind: "hook", ...declaration });
  },

  /**
   * Объявить инструмент для модели (docs/plugins.md). `id` служит и именем, которым инструмент зовёт
   * модель: имена инструментов у провайдеров ограничены `[A-Za-z0-9_-]`, поэтому неймспейс с точкой
   * в имя не ставится, а спор одноимённых разрешает сборка набора (docs/hooks.md).
   */
  tool: async <Schema extends z.ZodType>(tool: {
    id: string;
    title?: string;
    description: string;
    parameters: Schema;
    invoke: PluginToolInvoke<z.output<Schema>>;
  }): Promise<void> => {
    const { invoke, parameters, ...declaration } = tool;

    rememberToolInvoke(declaration.id, invoke as (toolArguments: never) => unknown);

    await currentPluginHost().contribute({
      kind: "tool",
      ...declaration,
      // Схема уезжает данными: в ней функции, а граница воркера — структурное клонирование.
      parameters: { ...z.toJSONSchema(parameters) },
    });
  },

  /**
   * Объявить HTTP-маршрут (docs/web-api.md). Адрес — `/api/p/<id плагина>/<path>`; проверку сессии
   * ставит диспетчер, а не обработчик, поэтому обычный маршрут защищён по построению.
   */
  route: async (route: RouteDeclaration): Promise<void> => declareRoute("route", route),

  /**
   * Объявить **публичный** маршрут: он отвечает без сессии. Это единственная поверхность платформы,
   * открытая наружу, и ответственность за неё целиком на авторе плагина — платформа своей схемы
   * аутентификации не навязывает, а лимит частоты и лимит тела ставит сама (docs/web-api.md).
   */
  publicRoute: async (route: RouteDeclaration): Promise<void> =>
    declareRoute("public-route", route),

  /**
   * Объявить цветовую схему (docs/ui-kit.md). Браузерного кода не требует: схема — данные, и
   * поэтому плагин с одной темой не собирается сборщиком вовсе.
   *
   * Имя, которым человек выбирает схему, — это `id` вклада с неймспейсом плагина. Полноту палитры и
   * мажор контракта токенов проверяет кит, уже в браузере: SDK о палитре не знает.
   */
  colorScheme: async (contribution: ColorSchemeContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "color-scheme", ...contribution }),

  /**
   * Объявить каталог сообщений (docs/ui-kit.md). Каталог для неймспейса `core` заменяет строки
   * платформы — и добавляет платформе язык, если такого ещё нет; каталог для своего неймспейса
   * называет строки самого плагина. Чужой неймспейс платформа не примет.
   */
  localeCatalog: async (contribution: LocaleCatalogContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "locale-catalog", ...contribution }),

  /**
   * Объявить место, куда другие плагины кладут свои компоненты (docs/ui-extension-model.md).
   * Заменяемым бывает только одиночное место, и у такого обязателен встроенный провайдер: иначе
   * замена снималась бы в пустоту.
   */
  place: async (contribution: PlaceContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "place", ...contribution }),

  /**
   * Занять место своим компонентом. Экспорт ищется в браузерном бандле плагина, поэтому вклад
   * осмыслен только у плагина, объявившего `sovereign.browser`.
   *
   * Место может ещё не появиться: порядок подъёма плагинов не определён, и вклад в неизвестное
   * место ждёт своего места, а не отвергается.
   */
  component: async (contribution: ComponentContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "component", ...contribution }),

  /**
   * Объявить команду — именованное действие (docs/ui-extension-model.md). Обработчик ищется по имени
   * экспорта в браузерном бандле, поэтому вклад осмыслен только у плагина с `sovereign.browser`.
   *
   * `placeId` необязателен: команда без места живёт в палитре и вызывается по идентификатору, в том
   * числе чужим плагином. Место, если указано, обязано быть кардинальности «действие».
   */
  command: async (contribution: CommandContribution): Promise<void> =>
    currentPluginHost().contribute({ kind: "command", ...contribution }),
};

type RouteDeclaration = Omit<RouteContribution, "method"> & {
  /** Не сказано — `GET`: маршрут без метода читается как чтение, а не как запись. */
  method?: RouteContribution["method"];
  handle: PluginRouteHandler;
};

async function declareRoute(
  kind: "route" | "public-route",
  route: RouteDeclaration,
): Promise<void> {
  const { handle, method, ...declaration } = route;

  // Обработчик запоминается до объявления: ядро вправе позвать маршрут сразу, как о нём узнало.
  rememberRouteHandler(kind, declaration.id, handle);

  await currentPluginHost().contribute({ kind, ...declaration, method: method ?? "GET" });
}

export const events = {
  /**
   * Слушать чужое событие по полному имени, вместе с неймспейсом публикатора. События ядра
   * слушаются так же, без исключений: журнала среди них нет, он идёт в `stdout` (docs/logging.md).
   *
   * Возвращает отписку. Пока плагин жив, подписка живёт: снимает её ядро вместе с плагином.
   */
  subscribe: subscribeToEvent,
};

/** Кто мы, по версии хоста. Полезно в логах самого плагина и в его собственных путях. */
export const identity = (): { id: string; source: string } => currentPluginHost().identity;

/**
 * Читаемое сообщение об ошибке схемы. z.prettifyError — недокументированный API zod 4
 * (зафиксирован минор в зависимостях), и на error-пути его пропадание глушит исходную ошибку
 * TypeError-ом поверх. flattenError — стабильный: возвращает {formErrors, fieldErrors}.
 */
function describeSchemaError(error: z.ZodError): string {
  const flat = z.flattenError(error);
  const lines: string[] = [...flat.formErrors];

  // fieldErrors типизирован как рекорд по ключам схемы, но здесь конкретная схема неизвестна —
  // поэтому индексируем как рекорд строк. Структуру flattenError гарантирует zod.
  const fieldErrors = flat.fieldErrors as Record<string, string[] | undefined>;

  for (const [field, messages] of Object.entries(fieldErrors)) {
    for (const message of messages ?? []) {
      lines.push(`${field}: ${message}`);
    }
  }

  return lines.length > 0 ? lines.join("; ") : "validation failed";
}
