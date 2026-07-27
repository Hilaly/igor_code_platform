import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPluginBusEvent, type BusEvent, type LogRecord } from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

import { createContributionRegistry, type ContributingPlugin } from "./contribution-registry.ts";
import { createEventBus } from "./event-bus.ts";
import { createLogger } from "./logger.ts";
import { createPluginEvents } from "./plugin-events.ts";

const tracker: ContributingPlugin = { key: "data:tracker", id: "tracker", source: "data" };

const taskCreated: PluginContribution = {
  kind: "event",
  id: "task.created",
  payloadSchema: { type: "object" },
};

function events() {
  const published: BusEvent[] = [];
  const records: LogRecord[] = [];
  const registry = createContributionRegistry();
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  bus.subscribe((event) => published.push(event));

  return {
    registry,
    published,
    records,
    events: createPluginEvents({
      registry,
      bus,
      logger: createLogger({
        source: "core",
        level: () => "debug",
        write: (record) => records.push(record),
      }),
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

    // Выключенный вклад — это публикация, которой больше нет (ADR-0032, ADR-0072).
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

    // Спор равных источников не применяет ни один вклад (ADR-0040), значит публиковать нечего.
    plugins.publish(tracker, "task.created", { id: "42" });
    plugins.publish(twin, "task.created", { id: "42" });

    assert.deepEqual(published, []);
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
