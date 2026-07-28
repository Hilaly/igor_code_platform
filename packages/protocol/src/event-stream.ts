/**
 * Контракт потока событий (docs/web-api.md). Поток отдаёт то же, что публикуется на шине, но добавляет
 * своё: индекс и время. Индекс присваивает поток, а не публикатор, — по нему клиент говорит «я
 * дочитал до сих пор» и получает пропущенное при переподключении.
 */

import type { CoreEventPayloads, PluginEventOrigin } from "./events.ts";

export const eventsPath = "/api/events";

/**
 * Позиция клиента в потоке. Браузерный `EventSource` присылает её заголовком `Last-Event-ID` сам;
 * параметр запроса — для всех остальных клиентов, которым заголовок ставить неоткуда.
 */
export const lastEventIdParameter = "lastEventId";

/**
 * Служебное сообщение: клиент назвал индекс, которого в окне уже нет, и пропущенного не существует.
 * Молча отдать огрызок нельзя — клиент считал бы своё состояние полным (docs/web-api.md).
 */
export const streamGapType = "core.stream.gap";

export type StreamGap = {
  /** Индекс, с которого клиент просил продолжить. */
  requestedIndex: number;
  /** Самый старый индекс, который поток ещё держит. Меньше него отдавать нечего. */
  oldestIndex: number;
};

export type StreamEventPayloads = CoreEventPayloads & {
  [streamGapType]: StreamGap;
};

export type StreamEventType = keyof StreamEventPayloads;

type StreamFrame = {
  /** Монотонный, начинается с единицы и сбрасывается при перезапуске демона. */
  index: number;
  /** Момент попадания в поток, ISO 8601. */
  time: string;
};

/** Кадр события ядра: тип определяет форму нагрузки. */
export type CoreStreamEvent = {
  [Type in StreamEventType]: StreamFrame & {
    type: Type;
    payload: StreamEventPayloads[Type];
  };
}[StreamEventType];

/**
 * Кадр события плагина. В поток он идёт наравне с событиями ядра, а не завёрнутым в них
 * (docs/web-api.md): для клиента это такое же событие, только имя пришло не из поставки.
 */
export type PluginStreamEvent = StreamFrame & {
  type: string;
  payload: unknown;
  plugin: PluginEventOrigin;
};

/** Кадр потока целиком: он же тело `data:`, разбирать SSE-поля клиенту не нужно. */
export type StreamEvent = CoreStreamEvent | PluginStreamEvent;

/**
 * Различает кадры так же, как шина различает события, — по наличию `plugin`. Без этого имя
 * события ядра перестаёт сужать нагрузку: у события плагина имя произвольное.
 */
export function isPluginStreamEvent(event: StreamEvent): event is PluginStreamEvent {
  return "plugin" in event;
}
