import {
  type ContributionRegistration,
  type PluginsSnapshot,
  type PluginStatus,
  type StreamEvent,
} from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyFailure,
  applySnapshot,
  applyStreamEvent,
  applyWrittenPreferences,
  initialPluginsState,
  type PluginsState,
} from "./state.ts";

const hello: PluginStatus = {
  key: "data:hello",
  id: "hello",
  source: "data",
  directory: "/plugins/hello",
  state: "running",
};

const board: ContributionRegistration = {
  id: "hello.board",
  declaredId: "board",
  kind: "custom",
  pluginKey: "data:hello",
  pluginId: "hello",
  source: "data",
};

const snapshot = (revision: number, plugins: PluginStatus[] = [hello]): PluginsSnapshot => ({
  revision,
  plugins,
  contributions: [board],
  switchedOffContributions: [],
  conflicts: [],
  enablement: { "data:hello": { enabled: true, disabledContributions: [] } },
});

const shown = (revision = 1, plugins: PluginStatus[] = [hello]): PluginsState =>
  applySnapshot(initialPluginsState, snapshot(revision, plugins));

const frame = (event: Omit<StreamEvent, "index" | "time">): StreamEvent =>
  ({ index: 1, time: "2026-07-27T08:12:08.713Z", ...event }) as StreamEvent;

describe("applyStreamEvent", () => {
  it("replaces the plugin row from the lifecycle payload without asking for a snapshot", () => {
    const failed: PluginStatus = { ...hello, state: "failed", reason: "boom", attempt: 1 };

    const outcome = applyStreamEvent(
      shown(),
      frame({ type: "core.plugin.lifecycle", payload: failed }),
    );

    expect(outcome.refetch).toBe(false);
    expect(outcome.state.snapshot?.plugins).toEqual([failed]);
  });

  it("asks for a snapshot when the lifecycle event names a plugin it has never seen", () => {
    const other: PluginStatus = { ...hello, key: "data:notes", id: "notes" };

    const outcome = applyStreamEvent(
      shown(),
      frame({ type: "core.plugin.lifecycle", payload: other }),
    );

    // Вклады нового плагина и решение о его включении живут в снимке, а не в кадре.
    expect(outcome.refetch).toBe(true);
    expect(outcome.state.snapshot?.plugins.map((plugin) => plugin.key)).toEqual([
      "data:hello",
      "data:notes",
    ]);
  });

  it("keeps the lifecycle event to itself until the first snapshot arrives", () => {
    const outcome = applyStreamEvent(
      initialPluginsState,
      frame({ type: "core.plugin.lifecycle", payload: hello }),
    );

    expect(outcome).toEqual({ state: initialPluginsState, refetch: false });
  });

  it("asks for a snapshot when the set of contributions changed", () => {
    const outcome = applyStreamEvent(
      shown(),
      frame({ type: "core.plugin.contributions", payload: { revision: 2, contributions: [] } }),
    );

    // В снимке есть то, чего в событии нет: выключенное, споры и решения о включении.
    expect(outcome.refetch).toBe(true);
    expect(outcome.state.snapshot?.contributions).toEqual([board]);
  });

  it("marks what is shown as possibly out of date on a gap", () => {
    const outcome = applyStreamEvent(
      shown(),
      frame({ type: "core.stream.gap", payload: { requestedIndex: 4, oldestIndex: 9 } }),
    );

    expect(outcome.refetch).toBe(true);
    expect(outcome.state.stale).toBe(true);
  });

  it("leaves an event published by a plugin alone", () => {
    const state = shown();
    const outcome = applyStreamEvent(state, {
      index: 7,
      time: "2026-07-27T08:12:08.713Z",
      type: "tracker.task.created",
      payload: { id: "15" },
      plugin: { key: "data:tracker", id: "tracker", source: "data" },
    });

    expect(outcome).toEqual({ state, refetch: false });
  });
});

describe("applySnapshot", () => {
  it("takes an answer whose revision is lower: the daemon restarted and started counting again", () => {
    // Ревизия живёт в памяти демона. Отбросить такой снимок значило бы показывать состояние
    // прошлой жизни демона именно тогда, когда свежее нужнее всего.
    const state = shown(4);

    expect(applySnapshot(state, snapshot(1)).snapshot?.revision).toBe(1);
  });

  it("takes an answer of the same revision: the statuses in it are newer", () => {
    const stopped: PluginStatus = { ...hello, state: "stopped" };

    expect(applySnapshot(shown(3), snapshot(3, [stopped])).snapshot?.plugins).toEqual([stopped]);
  });

  it("clears the out-of-date mark", () => {
    const stale = applyStreamEvent(
      shown(),
      frame({ type: "core.stream.gap", payload: { requestedIndex: 4, oldestIndex: 9 } }),
    ).state;

    expect(applySnapshot(stale, snapshot(2)).stale).toBe(false);
  });
});

describe("applyWrittenPreferences", () => {
  it("shows the written choice at once, without waiting for an event", () => {
    // Выключение вклада, ничего не изменившего в действующем наборе, не порождает ни одного кадра.
    const state = applyWrittenPreferences(shown(), "data:hello", {
      enabled: true,
      disabledContributions: ["hello.board"],
    });

    expect(state.snapshot?.enablement["data:hello"]).toEqual({
      enabled: true,
      disabledContributions: ["hello.board"],
    });
  });

  it("keeps the other plugins as they were", () => {
    const state = applySnapshot(initialPluginsState, {
      ...snapshot(1),
      enablement: {
        "data:hello": { enabled: true, disabledContributions: [] },
        "data:notes": { enabled: false, disabledContributions: ["notes.board"] },
      },
    });

    const written = applyWrittenPreferences(state, "data:hello", {
      enabled: false,
      disabledContributions: [],
    });

    expect(written.snapshot?.enablement["data:notes"]).toEqual({
      enabled: false,
      disabledContributions: ["notes.board"],
    });
  });

  it("takes the refusal off the screen when the next write goes through", () => {
    const refused = applyFailure(shown(), "the settings file was changed by someone else");

    expect(
      applyWrittenPreferences(refused, "data:hello", { enabled: true, disabledContributions: [] })
        .failure,
    ).toBeUndefined();
  });
});

describe("applyFailure", () => {
  it("keeps showing what it has: a refusal is not a reason to blank the view", () => {
    const state = applyFailure(shown(), "the daemon answered 409");

    expect(state.failure).toBe("the daemon answered 409");
    expect(state.snapshot?.plugins).toEqual([hello]);
  });
});
