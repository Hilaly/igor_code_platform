import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coreEventTypes, isPluginBusEvent, type BusEvent } from "./events.ts";

describe("isPluginBusEvent", () => {
  it("separates a plugin event from a core one and keeps the core payload typed", () => {
    const events: BusEvent[] = [
      {
        type: coreEventTypes.pluginLifecycle,
        payload: {
          key: "data:tracker",
          id: "tracker",
          source: "data",
          directory: "/plugins/tracker",
          state: "running",
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
      return event.type === coreEventTypes.pluginLifecycle ? event.payload.state : event.type;
    });

    assert.deepEqual(messages, ["running", "tracker said tracker.task.created"]);
  });
});
