/**
 * Шина событий (docs/event-bus.md): одна на процесс, доставка синхронная.
 *
 * Памяти у шины нет намеренно (docs/event-bus.md): буфера, курсоров и повторной доставки здесь не будет.
 * Подписчик, живой в момент публикации, событие получит; кто не подписан — не получит ничего и
 * спрашивает состояние у его владельца. Догон живёт в SSE-потоке, где у события есть индекс, а не
 * здесь: у шины нет порядка, который можно было бы пронумеровать.
 */

import type {
  BusEvent,
  CoreEventPayloads,
  CoreEventType,
  PluginBusEvent,
} from "@sovereign/protocol";

export type EventBusListener = (event: BusEvent) => void;

export type EventBus = {
  publish: <Type extends CoreEventType>(type: Type, payload: CoreEventPayloads[Type]) => void;
  /**
   * Событие плагина приходит собранным: имя с неймспейсом и происхождение проставляет тот, кто
   * знает плагина, — шина в это не вмешивается (docs/event-bus.md).
   */
  publishFromPlugin: (event: PluginBusEvent) => void;
  /** Возвращает функцию отписки. */
  subscribe: (listener: EventBusListener) => () => void;
};

export type CreateEventBusOptions = {
  /** Отказ подписчика. Обязателен: проглоченное исключение — это потерянное событие без следа. */
  onListenerError: (cause: unknown, event: BusEvent) => void;
};

export function createEventBus(options: CreateEventBusOptions): EventBus {
  const listeners = new Set<EventBusListener>();

  const deliver = (event: BusEvent): void => {
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
  };

  return {
    publish: (type, payload) => deliver({ type, payload } as BusEvent),
    publishFromPlugin: deliver,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
