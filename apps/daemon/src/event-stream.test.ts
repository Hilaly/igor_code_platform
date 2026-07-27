import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, get, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import {
  coreEventTypes,
  eventsPath,
  isPluginStreamEvent,
  streamGapType,
  type LogRecord,
  type PluginStatus,
  type StreamEvent,
} from "@sovereign/protocol";

import { createDispatcher } from "./dispatcher.ts";
import { createEventBus } from "./event-bus.ts";
import { createEventStream, type CreateEventStreamOptions } from "./event-stream.ts";
import { createLogger } from "./logger.ts";

const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** Образец события ядра: в потоке важен кадр вокруг нагрузки, а не сама нагрузка. */
const status = (key: string): PluginStatus => ({
  key,
  source: "data",
  directory: `/plugins/${key}`,
  state: "running",
});

/** Читает кадры потока и даёт дождаться нужного их количества: события приходят по сети. */
type Reader = {
  events: StreamEvent[];
  response: IncomingMessage;
  waitFor: (count: number) => Promise<StreamEvent[]>;
  comments: string[];
};

async function stream(options: Partial<CreateEventStreamOptions> = {}) {
  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (written) => records.push(written),
  });

  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  const events = createEventStream({ bus, logger, ...options });
  const server = createServer(createDispatcher({ routes: [events.route()], logger }));

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const read = async (lastEventId?: number): Promise<Reader> => {
    const headers = lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) };
    const request = get({ host: "127.0.0.1", port, path: eventsPath, headers });
    const [response] = (await once(request, "response")) as [IncomingMessage];

    const reader: Reader = {
      events: [],
      response,
      comments: [],
      waitFor: (count) =>
        new Promise((resolve, reject) => {
          const check = (): void => {
            if (reader.events.length >= count) {
              clearTimeout(timer);
              response.off("data", check);
              resolve(reader.events);
            }
          };

          const timer = setTimeout(() => {
            response.off("data", check);
            reject(
              new Error(
                `only ${reader.events.length} of ${count} frames arrived: ${JSON.stringify(reader.events)}`,
              ),
            );
          }, 5_000);

          response.on("data", check);
          check();
        }),
    };

    let buffer = "";

    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      buffer += chunk;

      let separator = buffer.indexOf("\n\n");

      while (separator !== -1) {
        const frame = buffer.slice(0, separator);

        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");

        if (frame.startsWith(":")) {
          reader.comments.push(frame);

          continue;
        }

        const data = /^data: (.*)$/m.exec(frame)?.[1];

        if (data !== undefined) {
          reader.events.push(JSON.parse(data) as StreamEvent);
        }
      }
    });

    return reader;
  };

  const publish = (key: string): void => bus.publish(coreEventTypes.pluginLifecycle, status(key));

  return { read, publish, records, close: () => events.close() };
}

const keysOf = (events: StreamEvent[]): string[] =>
  events.map((event) =>
    !isPluginStreamEvent(event) && event.type === coreEventTypes.pluginLifecycle
      ? event.payload.key
      : event.type,
  );

describe("createEventStream", () => {
  it("numbers events monotonically and delivers them one by one", async () => {
    const { read, publish } = await stream();
    const reader = await read();

    publish("first");
    publish("second");

    const events = await reader.waitFor(2);

    assert.deepEqual(
      events.map((event) => event.index),
      [1, 2],
    );
    assert.deepEqual(keysOf(events), ["first", "second"]);
    assert.equal(events[0]?.time, new Date(events[0]?.time ?? "").toISOString());
  });

  it("gives a fresh connection nothing that happened before it", async () => {
    const { read, publish } = await stream();

    publish("before");

    const reader = await read();

    publish("after");

    assert.deepEqual(keysOf(await reader.waitFor(1)), ["after"]);
  });

  it("catches a reconnected client up with exactly what it missed", async () => {
    const { read, publish } = await stream();

    publish("one");
    publish("two");
    publish("three");

    const reader = await read(1);
    const events = await reader.waitFor(2);

    assert.deepEqual(keysOf(events), ["two", "three"]);
    assert.deepEqual(
      events.map((event) => event.index),
      [2, 3],
    );
  });

  it("tells a client whose index is older than the window that the rest is lost", async () => {
    const { read, publish } = await stream({ windowSize: 2 });

    publish("one");
    publish("two");
    publish("three");

    // Клиент дочитал до нуля, а окно начинается со второго: первого события уже нет ни у кого.
    const reader = await read(0);
    const [gap] = await reader.waitFor(1);

    assert.equal(gap?.type, streamGapType);
    assert.deepEqual(gap?.type === streamGapType ? gap.payload : undefined, {
      requestedIndex: 0,
      oldestIndex: 2,
    });
    assert.equal(gap?.index, 3);
  });

  it("treats an index from a previous run of the daemon as a gap", async () => {
    const { read, publish } = await stream();

    publish("one");

    const reader = await read(42);
    const [gap] = await reader.waitFor(1);

    assert.equal(gap?.type, streamGapType);
  });

  it("keeps only the last events of the window", async () => {
    const { read, publish } = await stream({ windowSize: 2 });

    publish("one");
    publish("two");
    publish("three");

    const reader = await read(2);

    assert.deepEqual(keysOf(await reader.waitFor(1)), ["three"]);
  });

  it("disconnects a client that stopped reading and writes down why", async () => {
    const { read, publish, records } = await stream({ slowClientLimitBytes: 512 });
    const reader = await read();

    reader.response.pause();
    reader.response.socket?.pause();

    for (let attempt = 0; attempt < 200; attempt += 1) {
      publish(`flood ${attempt}`);
    }

    const complaint = records.find(
      (written) => written.message === "the event stream client fell behind and was disconnected",
    );

    assert.equal(complaint?.level, "warn");
    assert.ok(Number(complaint?.["pendingBytes"]) > 512);

    // Отцепленный клиент больше не мешает остальным: следующая публикация не падает и не ждёт его.
    publish("after the flood");
  });

  it("holds an idle connection open with a comment", async () => {
    const { read } = await stream({ pingIntervalMilliseconds: 10 });
    const reader = await read();

    await once(reader.response, "data");

    assert.ok(reader.comments.length > 0, "no ping arrived");
    assert.deepEqual(reader.events, []);
  });

  it("closes the connections on shutdown", async () => {
    const { read, close } = await stream();
    const reader = await read();

    close();

    await once(reader.response, "end");
  });
});
