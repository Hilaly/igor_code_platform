import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coreEventTypes, isPluginBusEvent, type BusEvent } from "./events.ts";

describe("isPluginBusEvent", () => {
  it("separates a plugin event from a core one and keeps the core payload typed", () => {
    const events: BusEvent[] = [
      {
        type: coreEventTypes.log,
        payload: {
          time: "2026-07-27T10:00:00.000Z",
          level: "info",
          source: "core",
          message: "daemon started",
        },
      },
      {
        type: "tracker.task.created",
        payload: { id: "42" },
        plugin: { key: "data:tracker", id: "tracker", source: "data" },
      },
    ];

    const messages = events.map((event) => {
      if (isPluginBusEvent(event)) {
        return `${event.plugin.id} said ${event.type}`;
      }

      // Сужение здесь и есть предмет проверки: отсеяв событие плагина, компилятор всё ещё
      // разбирает события ядра по типу, а не выдаёт `unknown` из-за соседа по объединению.
      return event.type === coreEventTypes.log ? event.payload.message : event.type;
    });

    assert.deepEqual(messages, ["daemon started", "tracker said tracker.task.created"]);
  });
});
