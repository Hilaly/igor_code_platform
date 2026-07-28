/**
 * Одно `EventSource` на приложение (docs/web-api.md): все события ядра и плагинов приходят одним потоком и
 * раздаются фронтовой шиной.
 *
 * Переподключение своё, а не браузерное. Браузер повторяет попытку сам, но только пока сервер отвечает
 * как положено: на HTTP-ошибку — а именно её отдаёт прокси, пока демон лежит, — `EventSource`
 * закрывается навсегда. Поэтому позиция хранится здесь и уезжает параметром `lastEventId`, а не
 * заголовком `Last-Event-ID`, который браузер ставит только своим попыткам (docs/web-api.md).
 *
 * Источник приходит параметром, а не создаётся внутри: `EventSource` в тестовой среде отсутствует, а
 * поведение при разрыве, при догоне и при негодном кадре проверять надо.
 */

import {
  eventsPath,
  lastEventIdParameter,
  streamGapType,
  type StreamEvent,
} from "@sovereign/protocol";

import type { FrontendBus } from "./bus.ts";

export type StreamStatus =
  /** Соединение открывается впервые. */
  | "connecting"
  | "open"
  /** Разрыв: попытка повторится, и пропущенное придёт догоном. */
  | "reconnecting";

/** Ровно то, что нужно от `EventSource`. */
export type EventSourceLike = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  close: () => void;
  /** `2` — соединение закрыто и сам браузер повторять не будет. */
  readyState: number;
};

export type OpenEventSource = (path: string) => EventSourceLike;

export type CancelScheduled = () => void;

export type StreamConnection = {
  status: () => StreamStatus;
  close: () => void;
};

export type ConnectEventStreamOptions = {
  bus: Pick<FrontendBus, "publish">;
  onStatus: (status: StreamStatus) => void;
  /** Негодный кадр, разрыв и пропуск — это диагностика, а не тишина: журнала у браузера нет. */
  onDiagnostic: (diagnostic: string) => void;
  open?: OpenEventSource;
  /** Планировщик под контролем теста: задержки повторов проверяются числами, а не ожиданием. */
  schedule?: (callback: () => void, delay: number) => CancelScheduled;
};

const closedReadyState = 2;

/** Пауза растёт до пяти секунд: демон могли остановить надолго, и долбить его незачем. */
const retryDelays = [500, 1_000, 2_000, 5_000];

export function connectEventStream(options: ConnectEventStreamOptions): StreamConnection {
  const open = options.open ?? ((path: string) => new EventSource(path));
  const schedule =
    options.schedule ??
    ((callback, delay) => {
      const timer = setTimeout(callback, delay);

      return () => clearTimeout(timer);
    });

  let status: StreamStatus = "connecting";
  let source: EventSourceLike | undefined;
  let cancelRetry: CancelScheduled | undefined;
  let attempt = 0;
  let lastIndex: number | undefined;
  let closedByUs = false;

  const moveTo = (next: StreamStatus): void => {
    if (next === status) {
      return;
    }

    status = next;
    options.onStatus(next);
  };

  const connect = (): void => {
    // Догон просится с той позиции, которую мы дочитали: без неё поток начался бы с текущего конца, и
    // пропущенное потерялось бы молча.
    const path =
      lastIndex === undefined ? eventsPath : `${eventsPath}?${lastEventIdParameter}=${lastIndex}`;
    const active = open(path);

    source = active;

    active.addEventListener("open", () => {
      attempt = 0;
      moveTo("open");
    });

    active.addEventListener("error", () => {
      moveTo("reconnecting");
      options.onDiagnostic("the event stream broke off");

      // Браузер повторяет сам, пока соединение не закрыто совсем; закрытое он не воскресит.
      if (closedByUs || active.readyState !== closedReadyState) {
        return;
      }

      active.close();

      const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)] ?? 5_000;

      attempt += 1;
      cancelRetry = schedule(connect, delay);
    });

    active.addEventListener("message", (event) => {
      const frame = parseFrame(event);

      if (frame === undefined) {
        // Кадр собирает демон из типов протокола: негодный json означает, что стороны разошлись.
        options.onDiagnostic("the event stream sent a frame that is not valid json");

        return;
      }

      lastIndex = frame.index;

      if (frame.type === streamGapType) {
        options.onDiagnostic(
          "the event stream no longer holds what we missed, the state has to be asked for again",
        );
      }

      options.bus.publish(frame);
    });
  };

  connect();

  return {
    status: () => status,
    close: () => {
      closedByUs = true;
      cancelRetry?.();
      source?.close();
    },
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
