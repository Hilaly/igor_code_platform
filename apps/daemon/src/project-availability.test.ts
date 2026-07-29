import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { coreEventTypes, type BusEvent, type ProjectAvailability } from "@sovereign/protocol";

import { createEventBus } from "./event-bus.ts";
import { createProjectAvailabilityWatcher, probeProjectFolder } from "./project-availability.ts";
import type { StoredProject } from "./project-store.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-availability-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function project(id: string, folder = `/code/${id}`): StoredProject {
  return {
    id,
    name: id,
    folder,
    folderKey: folder,
    archived: false,
    createdAt: "2026-07-29T00:00:00.000Z",
  };
}

/** Настоящий крошечный интервал плюс инъекция пробы — приём из `login-sessions.test.ts`. */
function watch(projects: StoredProject[], probe: (folder: string) => ProjectAvailability) {
  const events: BusEvent[] = [];
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  bus.subscribe((event) => events.push(event));

  const watcher = createProjectAvailabilityWatcher({
    projects: { list: () => projects },
    bus,
    probe,
    pollIntervalMilliseconds: 5,
  });

  return { watcher, events };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

describe("probeProjectFolder", () => {
  it("calls a directory available and everything else missing", () => {
    const folder = join(workspace, "there");
    const file = join(workspace, "file");

    mkdirSync(folder);
    writeFileSync(file, "");

    assert.equal(probeProjectFolder(folder), "available");
    assert.equal(probeProjectFolder(join(workspace, "not-there")), "missing");
    // Файл на месте папки — недоступность: сессию в нём всё равно не запустить.
    assert.equal(probeProjectFolder(file), "missing");
  });
});

describe("createProjectAvailabilityWatcher", () => {
  it("knows the state of every project without waiting for a tick", () => {
    const { watcher } = watch([project("a"), project("b")], (folder) =>
      folder === "/code/a" ? "available" : "missing",
    );

    assert.equal(watcher.of("a"), "available");
    assert.equal(watcher.of("b"), "missing");

    watcher.stop();
  });

  it("publishes nothing while nothing changes", async () => {
    const { watcher, events } = watch([project("a")], () => "available");

    await settle();
    watcher.stop();

    assert.deepEqual(events, []);
  });

  it("publishes one event when a folder disappears and one when it comes back", async () => {
    let present = true;
    const changes: number[] = [];
    const bus = createEventBus({
      onListenerError: (cause) => {
        throw cause;
      },
    });
    const events: BusEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const watcher = createProjectAvailabilityWatcher({
      projects: { list: () => [project("a")] },
      bus,
      probe: () => (present ? "available" : "missing"),
      onChange: () => changes.push(1),
      pollIntervalMilliseconds: 5,
    });

    present = false;
    await settle();

    assert.equal(watcher.of("a"), "missing");
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.projectsChanged],
    );

    present = true;
    await settle();

    assert.equal(watcher.of("a"), "available");
    assert.equal(events.length, 2, "the watcher is not a one-shot");
    assert.equal(changes.length, 2, "plugin state is reapplied for both transitions");

    watcher.stop();
  });

  it("goes quiet after stop", async () => {
    let present = true;
    const { watcher, events } = watch([project("a")], () => (present ? "available" : "missing"));

    watcher.stop();
    present = false;
    await settle();

    assert.deepEqual(events, []);
  });

  it("gives a project that appeared between ticks its state at once", () => {
    const projects = [project("a")];
    const { watcher } = watch(projects, (folder) =>
      folder === "/code/b" ? "missing" : "available",
    );

    projects.push(project("b"));

    // Список изменился — состояние нового проекта спрашивается сразу, а не через пять секунд:
    // иначе только что созданный проект показывался бы недоступным до первого тика.
    assert.equal(watcher.of("b"), "missing");

    watcher.stop();
  });

  it("says a project it never heard of is missing rather than throwing", () => {
    const { watcher } = watch([], () => "available");

    assert.equal(watcher.of("nope"), "missing");

    watcher.stop();
  });

  it("reads a probe that throws as a folder that is not there, and keeps ticking", async () => {
    // С отмонтированного тома `statSync` бросает `EIO` мимо `throwIfNoEntry`. Таймер обязан это
    // пережить, иначе наблюдатель умирает ровно в том случае, ради которого поставлен.
    let broken = false;
    let probes = 0;
    const { watcher, events } = watch([project("a")], () => {
      probes += 1;

      if (broken) {
        throw Object.assign(new Error("EIO: injected"), { code: "EIO" });
      }

      return "available";
    });

    broken = true;
    await settle();
    watcher.stop();

    assert.ok(probes > 2, "the timer kept going");
    assert.equal(watcher.of("a"), "missing");
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.projectsChanged],
    );
  });
});
