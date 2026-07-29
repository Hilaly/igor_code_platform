/**
 * Поверхность плагина: то, что он импортирует (docs/plugins.md). Имена импортов — публичный контракт,
 * менять их дороже, чем внутренности.
 *
 * Всё асинхронно (docs/plugins.md): плагин живёт в своём воркере, и любой вызов к платформе — сообщение.
 */

import { z } from "zod";

import { subscribeToEvent } from "./events.ts";
import { currentPluginHost, type CustomContribution, type PluginLogLevel } from "./host.ts";

export type { EventHandler, EventOrigin, Unsubscribe } from "./events.ts";

export type {
  CustomContribution,
  EventContribution,
  PayloadSchema,
  PluginContribution,
  PluginHost,
  PluginIdentity,
  PluginLogLevel,
} from "./host.ts";

/** Провайдеры LLM: операции над ними и типы, которыми платформа о них рассказывает. */
export { providers } from "./providers.ts";

export type {
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
};

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
