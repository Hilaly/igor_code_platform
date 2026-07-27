/**
 * Шина событий (ADR-0012): одна на процесс, доставка синхронная.
 *
 * Памяти у шины нет намеренно (ADR-0041): буфера, курсоров и повторной доставки здесь не будет.
 * Подписчик, живой в момент публикации, событие получит; кто не подписан — не получит ничего и
 * спрашивает состояние у его владельца. Догон живёт в SSE-потоке, где у события есть индекс, а не
 * здесь: у шины нет порядка, который можно было бы пронумеровать.
 */

import type { CoreEvent, CoreEventPayloads, CoreEventType } from "@sovereign/protocol";

export type EventBusListener = (event: CoreEvent) => void;

export type EventBus = {
  publish: <Type extends CoreEventType>(type: Type, payload: CoreEventPayloads[Type]) => void;
  /** Возвращает функцию отписки. */
  subscribe: (listener: EventBusListener) => () => void;
};

export type CreateEventBusOptions = {
  /**
   * Отказ подписчика. Обязателен: проглоченное исключение — это потерянное событие без следа.
   * Логгер сюда не передаётся напрямую — он публикует в эту же шину, и цикл логгер → шина →
   * логгер повесил бы демон; защиту от повторного входа ставит тот, кто шину создаёт.
   */
  onListenerError: (cause: unknown, event: CoreEvent) => void;
};

export function createEventBus(options: CreateEventBusOptions): EventBus {
  const listeners = new Set<EventBusListener>();

  return {
    publish: (type, payload) => {
      const event = { type, payload } as CoreEvent;

      // Набор копируется: подписчик имеет право отписаться или подписать другого прямо в
      // обработчике, а правка Set во время обхода меняет сам обход.
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (cause) {
          // Отказ одного подписчика не отменяет доставку остальным: они друг о друге не знают.
          options.onListenerError(cause, event);
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
