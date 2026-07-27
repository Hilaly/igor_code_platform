/**
 * Контракт потока событий (ADR-0038). Поток отдаёт то же, что публикуется на шине, но добавляет
 * своё: индекс и время. Индекс присваивает поток, а не публикатор, — по нему клиент говорит «я
 * дочитал до сих пор» и получает пропущенное при переподключении.
 */

import type { CoreEventPayloads } from "./events.ts";

export const eventsPath = "/api/events";

/**
 * Позиция клиента в потоке. Браузерный `EventSource` присылает её заголовком `Last-Event-ID` сам;
 * параметр запроса — для всех остальных клиентов, которым заголовок ставить неоткуда.
 */
export const lastEventIdParameter = "lastEventId";

/**
 * Служебное сообщение: клиент назвал индекс, которого в окне уже нет, и пропущенного не существует.
 * Молча отдать огрызок нельзя — клиент считал бы своё состояние полным (ADR-0038).
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

/** Кадр потока целиком: он же тело `data:`, разбирать SSE-поля клиенту не нужно. */
export type StreamEvent = {
  [Type in StreamEventType]: {
    /** Монотонный, начинается с единицы и сбрасывается при перезапуске демона. */
    index: number;
    /** Момент попадания в поток, ISO 8601. */
    time: string;
    type: Type;
    payload: StreamEventPayloads[Type];
  };
}[StreamEventType];
