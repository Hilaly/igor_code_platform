import {
  coreEventTypes,
  streamGapType,
  type Project,
  type ProjectsSnapshot,
  type StreamEvent,
} from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyConflict,
  applyFailure,
  applyLocalUpdate,
  applySnapshot,
  applyStreamEvent,
  clearComplaints,
  initialProjectsState,
  type ProjectsState,
} from "./state.ts";

let createdAt = 0;

/** Время создания растёт с каждой записью: по нему же демон и упорядочивает список. */
const project = (id: string, overrides: Partial<Project> = {}): Project => {
  createdAt += 1;

  return {
    id,
    name: id,
    folder: `/code/${id}`,
    folderKey: `/code/${id}`,
    archived: false,
    availability: "available",
    sessionCount: 0,
    ephemeral: false,
    createdAt: new Date(createdAt * 1_000).toISOString(),
    ...overrides,
  };
};

const snapshot = (projects: Project[], archived: Project[] = []): ProjectsSnapshot => ({
  projects,
  archived,
});

const withSnapshot = (value: ProjectsSnapshot): ProjectsState =>
  applySnapshot(initialProjectsState, value);

const frame = (type: string, payload: unknown = {}): StreamEvent =>
  ({ index: 1, time: "2026-07-29T00:00:00.000Z", type, payload }) as StreamEvent;

describe("applyStreamEvent", () => {
  it("asks for the list again on any project event", () => {
    // Нагрузки у события нет вовсе (docs/event-bus.md): что именно изменилось, знает только список.
    const outcome = applyStreamEvent(initialProjectsState, frame(coreEventTypes.projectsChanged));

    expect(outcome.refetch).toBe(true);
    expect(outcome.state).toBe(initialProjectsState);
  });

  it("marks the list stale on a gap and asks for it again", () => {
    const outcome = applyStreamEvent(initialProjectsState, frame(streamGapType));

    expect(outcome).toEqual({ state: { stale: true }, refetch: true });
  });

  it("ignores what is not about projects", () => {
    for (const type of [coreEventTypes.pluginLifecycle, coreEventTypes.preferencesChanged]) {
      expect(applyStreamEvent(initialProjectsState, frame(type)).refetch).toBe(false);
    }
  });

  it("ignores an event of a plugin", () => {
    const event = {
      index: 1,
      time: "2026-07-29T00:00:00.000Z",
      type: "tracker.task.created",
      payload: {},
      plugin: { key: "data:tracker", id: "tracker", source: "data" },
    } as StreamEvent;

    expect(applyStreamEvent(initialProjectsState, event).refetch).toBe(false);
  });
});

describe("applySnapshot", () => {
  it("takes the answer whole and drops the staleness with it", () => {
    const stale: ProjectsState = { stale: true, failure: "the daemon answered 500" };
    const next = applySnapshot(stale, snapshot([project("a")]));

    expect(next.stale).toBe(false);
    expect(next.failure).toBeUndefined();
    expect(next.snapshot?.projects).toHaveLength(1);
  });

  it("keeps a folder conflict: it is about the form, not about the list", () => {
    const conflicting = applyConflict(withSnapshot(snapshot([project("a")])), {
      error: "taken",
      project: project("a"),
    });

    expect(applySnapshot(conflicting, snapshot([project("a")])).conflict).toBeDefined();
  });
});

describe("applyLocalUpdate", () => {
  it("renames without waiting for the answer", () => {
    const state = withSnapshot(snapshot([project("a"), project("b")]));
    const next = applyLocalUpdate(state, "a", { name: "Другое", archived: false });

    expect(next.snapshot?.projects.map((one) => one.name)).toEqual(["Другое", "b"]);
  });

  it("moves an archived project into the other list and back", () => {
    const state = withSnapshot(snapshot([project("a"), project("b")]));
    const archived = applyLocalUpdate(state, "a", { name: "a", archived: true });

    expect(archived.snapshot?.projects.map((one) => one.id)).toEqual(["b"]);
    expect(archived.snapshot?.archived.map((one) => one.id)).toEqual(["a"]);

    const restored = applyLocalUpdate(archived, "a", { name: "a", archived: false });

    // Восстановленный возвращается на своё место, а не в конец. Первая версия брала порядок из
    // прежнего списка — и он деградировал с каждым переносом, потому что список уже переставлен.
    expect(restored.snapshot?.projects.map((one) => one.id)).toEqual(["a", "b"]);
  });

  it("does nothing at all before the first snapshot", () => {
    expect(applyLocalUpdate(initialProjectsState, "a", { name: "x", archived: false })).toBe(
      initialProjectsState,
    );
  });

  it("clears the complaints: the human just did something new", () => {
    const complained = applyConflict(applyFailure(withSnapshot(snapshot([project("a")])), "нет"), {
      error: "taken",
      project: project("a"),
    });
    const next = applyLocalUpdate(complained, "a", { name: "b", archived: false });

    expect(next.failure).toBeUndefined();
    expect(next.conflict).toBeUndefined();
  });
});

describe("clearComplaints", () => {
  it("takes away both the failure and the conflict", () => {
    const complained = applyConflict(applyFailure(initialProjectsState, "нет"), {
      error: "taken",
      project: project("a"),
    });

    expect(clearComplaints(complained)).toEqual({ stale: false });
  });
});
