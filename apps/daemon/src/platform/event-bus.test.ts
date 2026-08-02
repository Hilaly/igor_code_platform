import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPluginBusEvent, type BusEvent, type PluginStatus } from "@sovereign/protocol";

import { createEventBus, type CreateEventBusOptions } from "./event-bus.ts";

const status = (key: string): PluginStatus => ({
  key,
  source: "data",
  directory: `/plugins/${key}`,
  state: "running",
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

/** Тесты шины публикуют одно и то же событие: нагрузка остальных здесь ничего не меняет. */
const keyOf = (event: BusEvent): string => {
  assert.equal(event.type, "core.plugin.lifecycle");

  return !isPluginBusEvent(event) && event.type === "core.plugin.lifecycle"
    ? event.payload.key
    : "";
};

describe("createEventBus", () => {
  it("delivers what was published to a subscriber", () => {
    const { bus: events } = bus();
    const seen: BusEvent[] = [];

    events.subscribe((event) => seen.push(event));
    events.publish("core.plugin.lifecycle", status("data:hello"));

    assert.deepEqual(seen, [{ type: "core.plugin.lifecycle", payload: status("data:hello") }]);
  });

  it("stops delivering to a subscriber that unsubscribed", () => {
    const { bus: events } = bus();
    const seen: BusEvent[] = [];
    const unsubscribe = events.subscribe((event) => seen.push(event));

    events.publish("core.plugin.lifecycle", status("first"));
    unsubscribe();
    events.publish("core.plugin.lifecycle", status("second"));

    assert.deepEqual(seen.map(keyOf), ["first"]);
  });

  it("tells a late subscriber nothing about the past: the bus has no memory", () => {
    const { bus: events } = bus();
    const seen: BusEvent[] = [];

    events.publish("core.plugin.lifecycle", status("before"));
    events.subscribe((event) => seen.push(event));

    assert.deepEqual(seen, []);
  });

  it("keeps delivering to the others when one subscriber throws", () => {
    const { bus: events, failures } = bus();
    const seen: string[] = [];

    events.subscribe(() => {
      throw new Error("the listener is broken");
    });
    events.subscribe((event) => seen.push(keyOf(event)));

    events.publish("core.plugin.lifecycle", status("delivered anyway"));

    assert.deepEqual(seen, ["delivered anyway"]);
    assert.equal(failures.length, 1);
    assert.equal((failures[0]?.cause as Error).message, "the listener is broken");
    assert.equal(failures[0]?.event.type, "core.plugin.lifecycle");
  });

  it("lets a subscriber unsubscribe from inside its own handler", () => {
    const { bus: events } = bus();
    const seen: string[] = [];

    const unsubscribe = events.subscribe((event) => {
      seen.push(keyOf(event));
      unsubscribe();
    });
    events.subscribe((event) => seen.push(`second:${keyOf(event)}`));

    events.publish("core.plugin.lifecycle", status("first"));
    events.publish("core.plugin.lifecycle", status("second"));

    assert.deepEqual(seen, ["first", "second:first", "second:second"]);
  });
});
