/**
 * SSE-поток событий ядра (ADR-0038). Шина ничего не помнит и никого не догоняет (ADR-0041) — этим
 * занимается поток: он нумерует события, держит окно последних в памяти и по `Last-Event-ID`
 * отдаёт пропущенное.
 *
 * Пишем прямо в `ServerResponse`, без прослоек (ADR-0026): у SSE нет ничего, ради чего стоило бы
 * заводить зависимость, а прослойка скрыла бы буфер сокета, за которым здесь нужно следить.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  eventsPath,
  isPluginBusEvent,
  lastEventIdParameter,
  streamGapType,
  type StreamEvent,
} from "@sovereign/protocol";

import type { Route } from "./dispatcher.ts";
import type { EventBus } from "./event-bus.ts";
import type { Logger } from "./logger.ts";

export type EventStream = {
  route: () => Route;
  /** Закрыть все соединения. Вызывается при остановке демона до снятия лока. */
  close: () => void;
};

export type CreateEventStreamOptions = {
  bus: EventBus;
  logger: Logger;
  windowSize?: number;
  pingIntervalMilliseconds?: number;
  slowClientLimitBytes?: number;
  now?: () => number;
};

/**
 * Глубина окна догона. Сериализованный кадр — около двухсот байт (runtime-checks.md, проверка 20),
 * то есть тысяча событий стоит порядка 200 КБ на процесс. За эти деньги переподключение переживает
 * и разрыв сети, и перезагрузку страницы; экономить здесь не на чем.
 */
const defaultWindowSize = 1_000;

/** Комментарий-пинг: соединение без трафика закрывают и прокси, и операционная система. */
const defaultPingInterval = 15_000;

/**
 * Порог отцепления медленного клиента. Обратного давления у сокета нет вовсе: не читающий клиент
 * набирает два гигабайта за пять секунд, и демон умирает раньше него (runtime-checks.md,
 * проверка 19). Мегабайт неотданного — это тысячи кадров, то есть клиент не читает, а не отстал.
 */
const defaultSlowClientLimitBytes = 1024 * 1024;

type Client = {
  response: ServerResponse;
  address: string;
};

export function createEventStream(options: CreateEventStreamOptions): EventStream {
  const windowSize = options.windowSize ?? defaultWindowSize;
  const pingInterval = options.pingIntervalMilliseconds ?? defaultPingInterval;
  const slowClientLimitBytes = options.slowClientLimitBytes ?? defaultSlowClientLimitBytes;
  const now = options.now ?? Date.now;

  const recent: StreamEvent[] = [];
  const clients = new Set<Client>();

  let nextIndex = 1;

  // Очередь, а не прямая отправка: запись в журнал о выгнанном клиенте сама уходит в шину, и без
  // очереди вложенная публикация ушла бы в сокеты раньше той, что её вызвала. Индексы монотонны
  // только тогда, когда порядок отправки совпадает с порядком присвоения.
  const pending: StreamEvent[] = [];
  let sending = false;

  const unsubscribe = options.bus.subscribe((event) => {
    pending.push({
      index: nextIndex,
      time: new Date(now()).toISOString(),
      type: event.type,
      payload: event.payload,
      // Событие плагина едет в поток с происхождением: без него клиент не отличит его от
      // платформенного (ADR-0072).
      ...(isPluginBusEvent(event) ? { plugin: event.plugin } : {}),
    } as StreamEvent);

    nextIndex += 1;

    if (sending) {
      return;
    }

    sending = true;

    try {
      while (pending.length > 0) {
        const next = pending.shift();

        if (next === undefined) {
          break;
        }

        remember(next);

        for (const client of [...clients]) {
          deliver(client, next);
        }
      }
    } finally {
      sending = false;
    }
  });

  const ping = setInterval(() => {
    for (const client of clients) {
      client.response.write(": ping\n\n");
    }
  }, pingInterval);

  // Пинг не повод держать процесс живым: демон завершается по сигналу, а не по последнему таймеру.
  ping.unref();

  return {
    route: () => ({
      method: "GET",
      path: eventsPath,
      handle: ({ request, response, url }) => {
        connect(request, response, readLastEventId(request, url));
      },
    }),
    close: () => {
      clearInterval(ping);
      unsubscribe();

      for (const client of [...clients]) {
        clients.delete(client);
        client.response.end();
      }
    },
  };

  function remember(event: StreamEvent): void {
    recent.push(event);

    if (recent.length > windowSize) {
      recent.splice(0, recent.length - windowSize);
    }
  }

  function connect(
    request: IncomingMessage,
    response: ServerResponse,
    lastEventId: number | undefined,
  ): void {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // Заголовки уходят сразу: клиент считает соединение открытым по ним, а не по первому событию,
    // которого может не быть минутами. Nagle на потоке коротких кадров — та же задержка.
    response.flushHeaders();
    request.socket.setNoDelay(true);

    const client: Client = {
      response,
      address: request.socket.remoteAddress ?? "unknown",
    };

    clients.add(client);
    request.on("close", () => clients.delete(client));

    if (lastEventId === undefined) {
      return;
    }

    const oldestIndex = recent[0]?.index ?? nextIndex;

    // Индекс новее последнего выданного — это клиент прошлого запуска демона: нумерация начинается
    // заново, и его позиция ничего не значит.
    if (lastEventId + 1 < oldestIndex || lastEventId >= nextIndex) {
      deliver(client, {
        index: nextIndex - 1,
        time: new Date(now()).toISOString(),
        type: streamGapType,
        payload: { requestedIndex: lastEventId, oldestIndex },
      });

      return;
    }

    for (const event of recent.filter((event) => event.index > lastEventId)) {
      deliver(client, event);
    }
  }

  function deliver(client: Client, event: StreamEvent): void {
    // Тип и время лежат внутри `data`, а не в полях `id`/`event`: клиент разбирает один json, а не
    // сначала кадр SSE, потом его нагрузку.
    client.response.write(`id: ${event.index}\ndata: ${JSON.stringify(event)}\n\n`);

    if (client.response.writableLength <= slowClientLimitBytes) {
      return;
    }

    clients.delete(client);
    client.response.destroy();

    options.logger.warn("the event stream client fell behind and was disconnected", {
      client: client.address,
      pendingBytes: client.response.writableLength,
      index: event.index,
    });
  }
}

function readLastEventId(request: IncomingMessage, url: URL): number | undefined {
  const header = request.headers["last-event-id"];
  const raw = typeof header === "string" ? header : url.searchParams.get(lastEventIdParameter);

  if (raw === null || raw === undefined) {
    return undefined;
  }

  const value = Number(raw);

  // Нечитаемая позиция — это подключение без позиции, а не отказ: клиент получит поток с текущего
  // конца и заметит разрыв по своему состоянию.
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
