/**
 * Фронтовая шина (docs/web-api.md). Вьюхи подписываются на неё, а не на свои сетевые потоки: соединение с
 * демоном одно на вкладку, и второго ей взять негде.
 *
 * Памяти у шины нет, как и у шины демона (docs/event-bus.md): подписчик, живой в момент доставки, кадр
 * получит; остальное спрашивается у владельца состояния. Догон живёт в потоке, где у кадра есть
 * индекс.
 */

import type { BusStreamEvent } from "@sovereign/protocol";

export type FrontendBusListener = (event: BusStreamEvent) => void;

export type FrontendBus = {
  publish: (event: BusStreamEvent) => void;
  /** Возвращает функцию отписки. */
  subscribe: (listener: FrontendBusListener) => () => void;
};

export type CreateFrontendBusOptions = {
  /** Обязателен: упавший подписчик — это потерянный кадр, и молчать о нём нельзя. */
  onListenerError: (cause: unknown, event: BusStreamEvent) => void;
};

export function createFrontendBus(options: CreateFrontendBusOptions): FrontendBus {
  const listeners = new Set<FrontendBusListener>();

  return {
    publish: (event) => {
      // Набор копируется: подписчик имеет право отписаться прямо в обработчике, а правка Set во
      // время обхода меняет сам обход.
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
