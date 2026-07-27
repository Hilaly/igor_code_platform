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

/** Поддельный источник: `EventSource` в тестовой среде отсутствует, а разрывы проверять надо. */
function fakeSource() {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  let closed = false;

  const source: EventSourceLike = {
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close: () => {
      closed = true;
    },
  };

  const emit = (type: string, event: Event): void => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };

  return {
    source,
    closed: () => closed,
    open: () => emit("open", new Event("open")),
    fail: () => emit("error", new Event("error")),
    send: (frame: unknown) =>
      emit("message", { data: JSON.stringify(frame) } as MessageEvent<string>),
    sendRaw: (data: string) => emit("message", { data } as MessageEvent<string>),
  };
}

function connected() {
  const fake = fakeSource();
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
    open: () => fake.source,
  });

  return { ...fake, bus, connection, delivered, diagnostics, statuses };
}

describe("connectEventStream", () => {
  it("brings a frame from the stream to a bus subscriber", () => {
    const stream = connected();

    stream.open();
    stream.send(lifecycle);

    expect(stream.delivered).toEqual([lifecycle]);
    expect(stream.statuses).toEqual(["open"]);
  });

  it("says the state has to be asked for again on a gap", () => {
    const stream = connected();
    const gap = {
      index: 40,
      time: "2026-07-27T07:06:07.923Z",
      type: streamGapType,
      payload: { requestedIndex: 3, oldestIndex: 39 },
    };

    stream.send(gap);

    // Кадр всё равно доезжает: решение, что перезапрашивать, принимает владелец состояния.
    expect(stream.delivered).toEqual([gap]);
    expect(stream.diagnostics.join("\n")).toMatch(/asked for again/);
  });

  it("keeps its subscribers across a break", () => {
    const stream = connected();

    stream.open();
    stream.fail();
    stream.open();
    stream.send(lifecycle);

    expect(stream.delivered).toEqual([lifecycle]);
    expect(stream.statuses).toEqual(["open", "reconnecting", "open"]);
    expect(stream.diagnostics.join("\n")).toMatch(/reconnecting/);
  });

  it("reports a frame that is not valid json instead of throwing", () => {
    const stream = connected();

    stream.sendRaw("{ half a frame");

    expect(stream.delivered).toEqual([]);
    expect(stream.diagnostics.join("\n")).toMatch(/not valid json/);
  });

  it("closes the source it opened", () => {
    const stream = connected();

    stream.connection.close();

    expect(stream.closed()).toBe(true);
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
