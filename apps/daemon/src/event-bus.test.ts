import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPluginBusEvent, type BusEvent, type LogRecord } from "@sovereign/protocol";

import { createEventBus, type CreateEventBusOptions } from "./event-bus.ts";

const record = (message: string): LogRecord => ({
  time: "2026-07-27T10:00:00.000Z",
  level: "info",
  source: "core",
  message,
});

function bus(onListenerError: CreateEventBusOptions["onListenerError"] = () => {}) {
  const failures: { cause: unknown; event: BusEvent }[] = [];

  return {
    failures,
    bus: createEventBus({
      onListenerError: (cause, event) => {
        failures.push({ cause, event });
        onListenerError(cause, event);
      },
    }),
  };
}

/** Тесты шины публикуют только записи журнала: нагрузка остальных событий здесь ничего не меняет. */
const messageOf = (event: BusEvent): string => {
  assert.equal(event.type, "core.log");

  return !isPluginBusEvent(event) && event.type === "core.log" ? event.payload.message : "";
};

describe("createEventBus", () => {
  it("delivers what was published to a subscriber", () => {
    const { bus: events } = bus();
    const seen: BusEvent[] = [];

    events.subscribe((event) => seen.push(event));
    events.publish("core.log", record("daemon started"));

    assert.deepEqual(seen, [{ type: "core.log", payload: record("daemon started") }]);
  });

  it("stops delivering to a subscriber that unsubscribed", () => {
    const { bus: events } = bus();
    const seen: BusEvent[] = [];
    const unsubscribe = events.subscribe((event) => seen.push(event));

    events.publish("core.log", record("first"));
    unsubscribe();
    events.publish("core.log", record("second"));

    assert.deepEqual(seen.map(messageOf), ["first"]);
  });

  it("tells a late subscriber nothing about the past: the bus has no memory", () => {
    const { bus: events } = bus();
    const seen: BusEvent[] = [];

    events.publish("core.log", record("before"));
    events.subscribe((event) => seen.push(event));

    assert.deepEqual(seen, []);
  });

  it("keeps delivering to the others when one subscriber throws", () => {
    const { bus: events, failures } = bus();
    const seen: string[] = [];

    events.subscribe(() => {
      throw new Error("the listener is broken");
    });
    events.subscribe((event) => seen.push(messageOf(event)));

    events.publish("core.log", record("delivered anyway"));

    assert.deepEqual(seen, ["delivered anyway"]);
    assert.equal(failures.length, 1);
    assert.equal((failures[0]?.cause as Error).message, "the listener is broken");
    assert.equal(failures[0]?.event.type, "core.log");
  });

  it("lets a subscriber unsubscribe from inside its own handler", () => {
    const { bus: events } = bus();
    const seen: string[] = [];

    const unsubscribe = events.subscribe((event) => {
      seen.push(messageOf(event));
      unsubscribe();
    });
    events.subscribe((event) => seen.push(`second:${messageOf(event)}`));

    events.publish("core.log", record("first"));
    events.publish("core.log", record("second"));

    assert.deepEqual(seen, ["first", "second:first", "second:second"]);
  });
});
