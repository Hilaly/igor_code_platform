import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coreEventTypes,
  isPluginBusEvent,
  type BusEvent,
  type LogRecord,
} from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

import { createContributionRegistry, type ContributingPlugin } from "./contribution-registry.ts";
import { createEventBus } from "./platform/public.ts";
import { createLogger } from "./platform/public.ts";
import { createPluginEvents } from "./plugin-events.ts";
import type { PluginIncoming } from "./plugin-wire.ts";

const tracker: ContributingPlugin = { key: "data:tracker", id: "tracker", source: "data" };

const taskCreated: PluginContribution = {
  kind: "event",
  id: "task.created",
  payloadSchema: { type: "object" },
};

function events() {
  const published: BusEvent[] = [];
  const records: LogRecord[] = [];
  const delivered: { pluginKey: string; message: PluginIncoming }[] = [];
  const registry = createContributionRegistry();
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  bus.subscribe((event) => published.push(event));

  return {
    registry,
    bus,
    published,
    records,
    delivered,
    events: createPluginEvents({
      registry,
      bus,
      logger: createLogger({
        source: "core",
        level: () => "debug",
        write: (record) => records.push(record),
      }),
      send: (pluginKey, message) => delivered.push({ pluginKey, message }),
    }),
  };
}

const refusals = (records: LogRecord[]): unknown[] =>
  records
    .filter(
      (record) => record.message === "the plugin published an event that is not in effect for it",
    )
    .map((record) => record["event"]);

describe("createPluginEvents", () => {
  it("puts a declared event on the bus with its namespace and origin", () => {
    const { registry, events: plugins, published } = events();

    registry.apply(tracker, [taskCreated], new Set());
    plugins.publish(tracker, "task.created", { id: "42" });

    assert.deepEqual(published, [
      {
        type: "tracker.task.created",
        payload: { id: "42" },
        plugin: { key: "data:tracker", id: "tracker", source: "data" },
      },
    ]);
  });

  it("refuses an event the plugin never declared, and says so in the log", () => {
    const { events: plugins, published, records } = events();

    plugins.publish(tracker, "task.created", { id: "42" });

    assert.deepEqual(published, []);
    assert.deepEqual(refusals(records), ["tracker.task.created"]);
  });

  it("refuses an event whose contribution the human switched off", () => {
    const { registry, events: plugins, published, records } = events();

    // Выключенный вклад — это публикация, которой больше нет (docs/plugins.md, docs/event-bus.md).
    registry.apply(tracker, [taskCreated], new Set(["tracker.task.created"]));
    plugins.publish(tracker, "task.created", { id: "42" });

    assert.deepEqual(published, []);
    assert.deepEqual(refusals(records), ["tracker.task.created"]);
  });

  it("refuses an event that lost the conflict with a plugin of the same source", () => {
    const { registry, events: plugins, published } = events();
    const twin: ContributingPlugin = { key: "data:twin", id: "tracker", source: "data" };

    registry.apply(tracker, [taskCreated], new Set());
    registry.apply(twin, [taskCreated], new Set());

    // Спор равных источников не применяет ни один вклад (docs/plugins.md), значит публиковать нечего.
    plugins.publish(tracker, "task.created", { id: "42" });
    plugins.publish(twin, "task.created", { id: "42" });

    assert.deepEqual(published, []);
  });

  it("delivers a bus event only to the workers subscribed to it", () => {
    const { registry, events: plugins, delivered } = events();
    const automation: ContributingPlugin = {
      key: "data:automation",
      id: "automation",
      source: "data",
    };

    registry.apply(tracker, [taskCreated], new Set());
    plugins.subscribe(automation, "tracker.task.created");
    plugins.publish(tracker, "task.created", { id: "42" });

    assert.deepEqual(delivered, [
      {
        pluginKey: "data:automation",
        message: {
          kind: "event",
          type: "tracker.task.created",
          payload: { id: "42" },
          plugin: { key: "data:tracker", id: "tracker", source: "data" },
        },
      },
    ]);
  });

  it("delivers a core event too, without an origin: the core has no author", () => {
    const { bus, events: plugins, delivered } = events();
    const automation: ContributingPlugin = {
      key: "data:automation",
      id: "automation",
      source: "data",
    };

    plugins.subscribe(automation, coreEventTypes.pluginLifecycle);
    bus.publish(coreEventTypes.pluginLifecycle, {
      key: "data:tracker",
      id: "tracker",
      source: "data",
      directory: "/plugins/tracker",
      state: "running",
    });

    assert.deepEqual(delivered.at(0)?.message, {
      kind: "event",
      type: coreEventTypes.pluginLifecycle,
      payload: {
        key: "data:tracker",
        id: "tracker",
        source: "data",
        directory: "/plugins/tracker",
        state: "running",
      },
    });
  });

  it("drops the subscriptions of a plugin that went away", () => {
    const { registry, events: plugins, delivered } = events();
    const automation: ContributingPlugin = {
      key: "data:automation",
      id: "automation",
      source: "data",
    };

    registry.apply(tracker, [taskCreated], new Set());
    plugins.subscribe(automation, "tracker.task.created");
    plugins.remove("data:automation");
    plugins.publish(tracker, "task.created", { id: "42" });

    assert.deepEqual(delivered, []);
  });

  it("stops delivering after the plugin unsubscribed by name", () => {
    const { registry, events: plugins, delivered } = events();
    const automation: ContributingPlugin = {
      key: "data:automation",
      id: "automation",
      source: "data",
    };

    registry.apply(tracker, [taskCreated], new Set());
    plugins.subscribe(automation, "tracker.task.created");
    plugins.unsubscribe("data:automation", "tracker.task.created");
    plugins.publish(tracker, "task.created", { id: "42" });

    assert.deepEqual(delivered, []);
  });

  it("drops the bus subscription on close, so no event reaches a dead worker", () => {
    const { registry, events: plugins, delivered, published } = events();
    const automation: ContributingPlugin = {
      key: "data:automation",
      id: "automation",
      source: "data",
    };

    registry.apply(tracker, [taskCreated], new Set());
    plugins.subscribe(automation, "tracker.task.created");
    plugins.close();

    // Событие публикуется обычным путём и проходит по шине, но после close подписка PluginEvents
    // снята — до воркера оно не доходит.
    plugins.publish(tracker, "task.created", { id: "42" });

    assert.equal(published.length, 1);
    assert.deepEqual(delivered, []);
  });

  it("does not let one plugin publish under the name of another", () => {
    const { registry, events: plugins, published } = events();
    const automation: ContributingPlugin = {
      key: "data:automation",
      id: "automation",
      source: "data",
    };

    registry.apply(tracker, [taskCreated], new Set());
    plugins.publish(automation, "task.created", { id: "42" });

    // Неймспейс ставит ядро по идентичности воркера: соседнее имя даже не совпадает.
    assert.deepEqual(
      published.filter(isPluginBusEvent).map((event) => event.type),
      [],
    );
  });
});
