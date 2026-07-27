import { describe, expect, it } from "vitest";

import { coreEventTypes, streamGapType, type StreamEvent } from "@sovereign/protocol";

import { createFrontendBus } from "./bus.ts";
import { connectEventStream, type EventSourceLike, type StreamStatus } from "./stream.ts";

const lifecycle: StreamEvent = {
  index: 18,
  time: "2026-07-27T07:06:07.923Z",
  type: coreEventTypes.pluginLifecycle,
  payload: { key: "data:hello", id: "hello", source: "data", directory: "/p", state: "running" },
};

const gap: StreamEvent = {
  index: 40,
  time: "2026-07-27T07:06:07.923Z",
  type: streamGapType,
  payload: { requestedIndex: 3, oldestIndex: 39 },
};

/** Поддельный источник: `EventSource` в тестовой среде отсутствует, а разрывы проверять надо. */
function fakeSource() {
  const listeners = new Map<string, ((event: Event) => void)[]>();

  const source: EventSourceLike & { closed: boolean } = {
    readyState: 0,
    closed: false,
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close: () => {
      source.closed = true;
    },
  };

  const emit = (type: string, event: Event): void => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };

  return {
    source,
    open: () => {
      source.readyState = 1;
      emit("open", new Event("open"));
    },
    /** Разрыв, после которого браузер повторяет сам. */
    stumble: () => {
      source.readyState = 0;
      emit("error", new Event("error"));
    },
    /** Отказ, на котором браузер закрывает соединение навсегда: ровно это делает прокси без демона. */
    give_up: () => {
      source.readyState = 2;
      emit("error", new Event("error"));
    },
    send: (frame: unknown) =>
      emit("message", { data: JSON.stringify(frame) } as MessageEvent<string>),
    sendRaw: (data: string) => emit("message", { data } as MessageEvent<string>),
  };
}

function connected() {
  const sources: ReturnType<typeof fakeSource>[] = [];
  const paths: string[] = [];
  const scheduled: { callback: () => void; delay: number }[] = [];
  const delivered: StreamEvent[] = [];
  const diagnostics: string[] = [];
  const statuses: StreamStatus[] = [];
  const bus = createFrontendBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  bus.subscribe((event) => delivered.push(event));

  const connection = connectEventStream({
    bus,
    onStatus: (status) => statuses.push(status),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    open: (path) => {
      paths.push(path);

      const next = fakeSource();

      sources.push(next);

      return next.source;
    },
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });

      return () => {
        scheduled.splice(scheduled.indexOf({ callback, delay }), 1);
      };
    },
  });

  return {
    bus,
    connection,
    paths,
    delivered,
    diagnostics,
    statuses,
    scheduled,
    latest: () => sources[sources.length - 1] as ReturnType<typeof fakeSource>,
    sources,
  };
}

describe("connectEventStream", () => {
  it("brings a frame from the stream to a bus subscriber", () => {
    const stream = connected();

    stream.latest().open();
    stream.latest().send(lifecycle);

    expect(stream.delivered).toEqual([lifecycle]);
    expect(stream.statuses).toEqual(["open"]);
    expect(stream.paths).toEqual(["/api/events"]);
  });

  it("says the state has to be asked for again on a gap", () => {
    const stream = connected();

    stream.latest().send(gap);

    // Кадр всё равно доезжает: решение, что перезапрашивать, принимает владелец состояния.
    expect(stream.delivered).toEqual([gap]);
    expect(stream.diagnostics.join("\n")).toMatch(/asked for again/);
  });

  it("leaves a break the browser handles itself alone", () => {
    const stream = connected();

    stream.latest().open();
    stream.latest().stumble();

    expect(stream.scheduled).toEqual([]);
    expect(stream.statuses).toEqual(["open", "reconnecting"]);
  });

  it("reconnects itself when the browser gave up, and asks for what it missed", () => {
    const stream = connected();

    stream.latest().open();
    stream.latest().send(lifecycle);
    stream.latest().give_up();

    expect(stream.scheduled).toHaveLength(1);
    expect(stream.scheduled[0]?.delay).toBe(500);

    stream.scheduled[0]?.callback();

    expect(stream.paths).toEqual(["/api/events", "/api/events?lastEventId=18"]);

    stream.latest().open();
    stream.latest().send({ ...lifecycle, index: 19 });

    expect(stream.delivered.map((event) => event.index)).toEqual([18, 19]);
    expect(stream.statuses).toEqual(["open", "reconnecting", "open"]);
  });

  it("waits longer with every attempt that fails", () => {
    const stream = connected();

    for (const expected of [500, 1_000, 2_000, 5_000, 5_000]) {
      stream.latest().give_up();

      const pending = stream.scheduled.pop();

      expect(pending?.delay).toBe(expected);
      pending?.callback();
    }
  });

  it("reports a frame that is not valid json instead of throwing", () => {
    const stream = connected();

    stream.latest().sendRaw("{ half a frame");

    expect(stream.delivered).toEqual([]);
    expect(stream.diagnostics.join("\n")).toMatch(/not valid json/);
  });

  it("stops trying once it is closed", () => {
    const stream = connected();

    stream.connection.close();
    stream.latest().give_up();

    expect(stream.latest().source.closed).toBe(true);
    expect(stream.scheduled).toEqual([]);
    expect(stream.paths).toHaveLength(1);
  });
});

describe("createFrontendBus", () => {
  it("stops delivering to whoever unsubscribed", () => {
    const bus = createFrontendBus({
      onListenerError: (cause) => {
        throw cause;
      },
    });
    const seen: StreamEvent[] = [];
    const unsubscribe = bus.subscribe((event) => seen.push(event));

    bus.publish(lifecycle);
    unsubscribe();
    bus.publish(lifecycle);

    expect(seen).toHaveLength(1);
  });

  it("delivers to the rest when one subscriber throws", () => {
    const failures: unknown[] = [];
    const bus = createFrontendBus({ onListenerError: (cause) => failures.push(cause) });
    const seen: StreamEvent[] = [];

    bus.subscribe(() => {
      throw new Error("this view is broken");
    });
    bus.subscribe((event) => seen.push(event));
    bus.publish(lifecycle);

    expect(seen).toEqual([lifecycle]);
    expect(failures).toHaveLength(1);
  });
});
