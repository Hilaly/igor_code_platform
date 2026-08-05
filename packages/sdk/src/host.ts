/**
 * Хэндл хоста: то, через что `@sovereign/sdk` разговаривает с платформой. Ставит его бутстрап
 * воркера до импорта кода плагина (docs/plugins.md), а в тестах — шов из `@sovereign/sdk/testing`.
 * Авторам плагинов эта точка входа не нужна.
 *
 * Хэндл живёт на символе в `globalThis`, а не в переменной модуля, потому что модуля бывает два:
 * у внешнего плагина в `node_modules` лежит своя копия пакета, и состояние, записанное в копию
 * бутстрапа, до плагина не дойдёт ([runtime-checks.md](../../../docs/runtime-checks.md),
 * проверка 15). У воркера свой `globalThis`, поэтому чужой плагин к чужому хосту не дотянется.
 */

import type {
  LoginConclusion,
  LoginInput,
  ProviderRequest,
  ProviderResponse,
} from "./providers.ts";
import type { SessionRequest, SessionResponse } from "./sessions.ts";

const hostSymbol = Symbol.for("sovereign.plugin.host");

/**
 * Уровни повторяют журнал платформы. Дубль намеренный: SDK ставится извне и не тянет за собой
 * внутренние пакеты — иначе публикуемая поверхность потянет за собой весь протокол.
 */
export type PluginLogLevel = "debug" | "info" | "warn" | "error";

/** Кто мы. Приходит от хоста: сам себя плагин не называет (docs/logging.md). */
export type PluginIdentity = {
  id: string;
  source: string;
};

/**
 * Общий вид вклада (docs/plugins.md): идентификатор, метаданные отображения, произвольная нагрузка.
 * Типизированные виды появляются вместе со своими потребителями.
 */
export type CustomContribution = {
  /** Без неймспейса: его добавляет хост, объявить чужой нельзя (docs/ui-extension-model.md, docs/event-bus.md). */
  id: string;
  title?: string;
  description?: string;
  payload?: unknown;
};

/**
 * Схема нагрузки, превращённая в данные. К хосту едет описание, а не схема: в схеме функции, а
 * граница воркера — структурное клонирование (docs/event-bus.md).
 */
export type PayloadSchema = Record<string, unknown>;

/** Объявление события шины (docs/event-bus.md). Идентификатор вклада — это имя события. */
export type EventContribution = {
  id: string;
  title?: string;
  description?: string;
  payloadSchema: PayloadSchema;
};

/**
 * Уровень ризонинга. Копия списка из протокола, как и остальные типы здесь: внутренние пакеты в
 * папку внешнего плагина не тянутся, а расхождение копии ловит компилятор в мосте демона
 * (docs/public-contract.md).
 */
export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof thinkingLevels)[number];

/**
 * Отбор инструментов агента шаблонами имён. Метасимвол один — `*`; `exclude` приоритетнее `include`
 * (docs/plugins.md).
 */
export type AgentToolSelection = {
  include: string[];
  exclude?: string[];
};

/** Скилы выбираются теми же glob-шаблонами, что и инструменты. */
export type AgentSkillSelection = {
  include: string[];
  exclude?: string[];
};

/**
 * Объявление агента (docs/plugins.md). Модель и уровень ризонинга — умолчания, а не запрет: при
 * создании сессии их переопределяют.
 */
export type AgentContribution = {
  id: string;
  title?: string;
  description?: string;
  instructions: string;
  tools?: AgentToolSelection;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  skills?: AgentSkillSelection;
};

/**
 * Насколько подписка обязательна (docs/hooks.md). Копия списка из протокола, как и остальные типы
 * здесь. Не сказано — ядро подставит `advisory`: критичность по умолчанию значила бы, что забывший
 * пометку автор роняет турны.
 */
export const hookCriticalities = ["advisory", "critical"] as const;

export type HookCriticality = (typeof hookCriticalities)[number];

/**
 * Объявление подписки на хук — то, что уходит хосту. Обработчик остаётся в воркере: через границу
 * ходит структурное клонирование, а функция им не переносится (docs/hooks.md).
 */
export type HookContribution = {
  id: string;
  title?: string;
  description?: string;
  event: string;
  criticality?: HookCriticality;
};

/**
 * Объявление инструмента. Идентификатор вклада служит и **именем, которым инструмент зовёт
 * модель**: второе имя рядом было бы вторым способом сказать то же, а имена инструментов у
 * провайдеров ограничены `[A-Za-z0-9_-]` — неймспейс с точкой в них не проходит.
 */
export type ToolContribution = {
  id: string;
  title?: string;
  /** Что читает модель. Обязательно: без описания инструмент ей бесполезен. */
  description: string;
  parameters: PayloadSchema;
};

/** То, что уходит хосту: вид проставляет SDK, а не автор плагина. */
export type PluginContribution =
  | ({ kind: "custom" } & CustomContribution)
  | ({ kind: "event" } & EventContribution)
  | ({ kind: "agent" } & AgentContribution)
  | ({ kind: "hook" } & HookContribution)
  | ({ kind: "tool" } & ToolContribution);

export type PluginHost = {
  identity: PluginIdentity;
  log: (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => Promise<void>;
  contribute: (contribution: PluginContribution) => Promise<void>;
  /**
   * Нагрузка проверена схемой здесь же, в воркере публикатора (docs/event-bus.md). Имя объявленное, без
   * неймспейса: неймспейс ставит хост по идентичности, поэтому чужим именем не опубликуешь.
   */
  publishEvent: (declaredId: string, payload: unknown) => Promise<void>;
  /**
   * Имя полное: подписываются на чужое событие, и неймспейс в нём чужой. Ядру сообщается имя, а не
   * обработчик, — обработчики остаются в воркере (docs/event-bus.md).
   */
  subscribeEvent: (type: string) => Promise<void>;
  unsubscribeEvent: (type: string) => Promise<void>;
  /**
   * Один из двух методов хоста, у которых есть ответ. Односторонность канала — правило, а не
   * недоделка, и исключений ровно два: провайдеры и сессии. Список, статус и вход бессмысленны без
   * ответа, а общего RPC у платформы нет (docs/plugins.md, docs/models-and-providers.md).
   */
  providers: (request: ProviderRequest) => Promise<ProviderResponse>;
  /**
   * Вторая пара «запрос-ответ» в канале плагина — сессии агента. Односторонность канала остаётся
   * правилом: исключений ровно два, и оба сделаны там, где операция без ответа бессмысленна
   * (docs/plugins.md, docs/sessions-and-projects.md).
   */
  sessions: (request: SessionRequest) => Promise<SessionResponse>;
  /**
   * Вход стоит отдельно от остальных операций, потому что у него есть обратный канал: вопросы
   * приходят по ходу диалога. Сам диалог границу воркера не пересекает — в нём функции, а граница
   * это структурное клонирование; наружу уезжают только шаги (docs/models-and-providers.md).
   */
  login: (input: LoginInput) => Promise<LoginConclusion>;
};

export function installPluginHost(host: PluginHost): void {
  (globalThis as Record<symbol, unknown>)[hostSymbol] = host;
}

export function removePluginHost(): void {
  delete (globalThis as Record<symbol, unknown>)[hostSymbol];
}

/**
 * Ошибка вместо падения по `undefined`: SDK, вызванный вне воркера плагина, обязан объяснить,
 * что произошло (docs/plugins.md) — иначе автор увидит «cannot read property of undefined».
 */
export function currentPluginHost(): PluginHost {
  const host = (globalThis as Record<symbol, unknown>)[hostSymbol];

  if (host === undefined) {
    throw new Error(
      "The sovereign sdk is not initialised: it works inside a plugin worker started by the " +
        "platform. In tests install the seam from @sovereign/sdk/testing before importing the plugin.",
    );
  }

  return host as PluginHost;
}
