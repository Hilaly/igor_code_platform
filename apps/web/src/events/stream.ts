/**
 * Одно `EventSource` на приложение (ADR-0017): все события ядра и плагинов приходят одним потоком и
 * раздаются фронтовой шиной. Позицию `Last-Event-ID` браузер присылает сам, поэтому переподключение
 * ничего не теряет — кроме случая, когда пропущенного уже нет: тогда приходит `core.stream.gap`, и
 * состояние надо перезапросить целиком (ADR-0038).
 *
 * Источник приходит параметром, а не создаётся здесь: `EventSource` в тестовой среде отсутствует, а
 * поведение при разрыве и при негодном кадре проверять надо.
 */

import { eventsPath, streamGapType, type StreamEvent } from "@sovereign/protocol";

import type { FrontendBus } from "./bus.ts";

export type StreamStatus =
  /** Соединение открывается впервые. */
  | "connecting"
  | "open"
  /** Разрыв. Браузер переподключается сам и присылает позицию. */
  | "reconnecting";

/** Ровно то, что нужно от `EventSource`. */
export type EventSourceLike = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  close: () => void;
};

export type OpenEventSource = (path: string) => EventSourceLike;

export type StreamConnection = {
  status: () => StreamStatus;
  close: () => void;
};

export type ConnectEventStreamOptions = {
  bus: Pick<FrontendBus, "publish">;
  onStatus: (status: StreamStatus) => void;
  /** Негодный кадр и разрыв — это диагностика, а не тишина: своего журнала у браузера нет. */
  onDiagnostic: (diagnostic: string) => void;
  open?: OpenEventSource;
};

export function connectEventStream(options: ConnectEventStreamOptions): StreamConnection {
  const open = options.open ?? ((path: string) => new EventSource(path));
  const source = open(eventsPath);

  let status: StreamStatus = "connecting";

  const moveTo = (next: StreamStatus): void => {
    if (next === status) {
      return;
    }

    status = next;
    options.onStatus(next);
  };

  source.addEventListener("open", () => moveTo("open"));

  source.addEventListener("error", () => {
    // `EventSource` переподключается сам, поэтому это не конец потока, а его пауза.
    moveTo("reconnecting");
    options.onDiagnostic("the event stream broke off, the browser is reconnecting");
  });

  source.addEventListener("message", (event) => {
    const frame = parseFrame(event);

    if (frame === undefined) {
      // Кадр собирает демон из типов протокола: негодный json здесь означает, что стороны разошлись,
      // и молчать об этом нельзя.
      options.onDiagnostic("the event stream sent a frame that is not valid json");

      return;
    }

    if (frame.type === streamGapType) {
      options.onDiagnostic(
        "the event stream no longer holds what we missed, the state has to be asked for again",
      );
    }

    options.bus.publish(frame);
  });

  return {
    status: () => status,
    close: () => source.close(),
  };
}

function parseFrame(event: Event): StreamEvent | undefined {
  const data = (event as MessageEvent<string>).data;

  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return undefined;
  }
}
