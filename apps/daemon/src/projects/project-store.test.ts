import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";

import { ensureDataDirectory, workDirectoryName } from "../platform/public.ts";
import { createLogger } from "../platform/public.ts";
import {
  createProjectStore,
  ephemeralProjectId,
  projectsFileName,
  type ProjectStore,
} from "./project-store.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-project-store-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

let directories = 0;
let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
});

/** Логгер собирает записи: политика «битый файл — отказ» обязана быть слышна в журнале. */
function logger() {
  return createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });
}

function store(contents?: string): { store: ProjectStore; directory: string } {
  directories += 1;

  const directory = ensureDataDirectory(join(workspace, `data-${directories}`));

  if (contents !== undefined) {
    writeFileSync(join(directory, projectsFileName), contents);
  }

  return { store: createProjectStore({ directory, logger: logger() }), directory };
}

function draft(folder: string, name = "Проект") {
  return { folder, name, folderKey: folder.toLowerCase() };
}

function created(target: ProjectStore, folder: string, name?: string) {
  const outcome = target.create(draft(folder, name));

  assert.ok(outcome.kind === "created", `${folder} must be created`);

  return outcome.project;
}

function stored(directory: string): unknown {
  return JSON.parse(readFileSync(join(directory, projectsFileName), "utf8"));
}

describe("the ephemeral project", () => {
  it("is there before anything was created", () => {
    const { store: projects, directory } = store();
    const [work, ...rest] = projects.list();

    assert.deepEqual(rest, []);
    assert.equal(work?.id, ephemeralProjectId);
    assert.equal(work?.folder, join(directory, workDirectoryName));
    assert.equal(work?.archived, false);
  });

  it("comes first and keeps its identifier across restarts", () => {
    const { store: projects, directory } = store();

    created(projects, "/code/one");

    assert.equal(projects.list()[0]?.id, ephemeralProjectId);

    const restarted = createProjectStore({ directory, logger: logger() });

    assert.equal(restarted.list()[0]?.id, ephemeralProjectId);
    assert.equal(restarted.list().length, 2);
  });

  it("never reaches the file", () => {
    const { store: projects, directory } = store();

    created(projects, "/code/one");

    assert.deepEqual(
      (stored(directory) as { projects: { id: string }[] }).projects.map((entry) => entry.id),
      [projects.list()[1]?.id],
    );
  });

  it("is found by its folder, so a project cannot be created on it a second time", () => {
    const { store: projects, directory } = store();
    const key = projects.list()[0]?.folderKey ?? "";

    assert.equal(projects.findByFolderKey(key)?.id, ephemeralProjectId);
    assert.equal(
      projects.create({
        folder: join(directory, workDirectoryName),
        name: "Второй",
        folderKey: key,
      }).kind,
      "taken",
    );
  });

  it("refuses every change, renaming included", () => {
    // Он не архивируется и не удаляется (docs/sessions-and-projects.md); переименование туда же —
    // записи на диске у него нет, а имя даёт локализация.
    const { store: projects } = store();

    assert.equal(
      projects.update(ephemeralProjectId, { name: "Моё", archived: false }).kind,
      "ephemeral",
    );
    assert.equal(
      projects.update(ephemeralProjectId, { name: "work", archived: true }).kind,
      "ephemeral",
    );
    assert.equal(projects.remove(ephemeralProjectId).kind, "ephemeral");
  });
});

describe("creating a project", () => {
  it("gives the record an identifier and keeps what it was told", () => {
    const { store: projects } = store();
    const project = created(projects, "/code/platform", "Платформа");

    assert.match(project.id, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(project.id, ephemeralProjectId);
    assert.equal(project.name, "Платформа");
    assert.equal(project.folder, "/code/platform");
    assert.equal(project.archived, false);
    assert.ok(!Number.isNaN(Date.parse(project.createdAt)));
  });

  it("refuses a second project on the same folder and names the first", () => {
    const { store: projects } = store();
    const first = created(projects, "/code/platform");
    const second = projects.create(draft("/code/platform", "Второй"));

    assert.ok(second.kind === "taken");
    assert.equal(second.conflict.id, first.id);
  });

  it("sees the collision through the key, not the human-readable folder", () => {
    const { store: projects } = store();

    created(projects, "/code/platform");

    const second = projects.create({
      folder: "/Code/Platform",
      name: "Второй",
      folderKey: "/code/platform",
    });

    assert.equal(second.kind, "taken");
  });

  it("survives a restart", () => {
    const { store: projects, directory } = store();
    const project = created(projects, "/code/platform", "Платформа");
    const restarted = createProjectStore({ directory, logger: logger() });

    assert.deepEqual(restarted.find(project.id), project);
  });
});

describe("changing a project", () => {
  it("renames, archives and restores through one write", () => {
    const { store: projects } = store();
    const project = created(projects, "/code/platform", "Платформа");
    const renamed = projects.update(project.id, { name: "Другое", archived: true });

    assert.ok(renamed.kind === "updated");
    assert.equal(renamed.project.name, "Другое");
    assert.equal(renamed.project.archived, true);
    assert.equal(renamed.project.folder, project.folder, "the folder is fixed at creation");

    const restored = projects.update(project.id, { name: "Другое", archived: false });

    assert.ok(restored.kind === "updated");
    assert.equal(restored.project.archived, false);
  });

  it("removes the record for good", () => {
    const { store: projects } = store();
    const project = created(projects, "/code/platform");

    assert.equal(projects.remove(project.id).kind, "removed");
    assert.equal(projects.find(project.id), undefined);

    // Папка освободилась: удаление безвозвратное, и правило «один путь — один проект» держится
    // только на живых записях.
    assert.equal(projects.create(draft("/code/platform")).kind, "created");
  });

  it("does not invent a record for an unknown identifier", () => {
    const { store: projects } = store();

    assert.equal(projects.update("nope", { name: "Имя", archived: false }).kind, "unknown");
    assert.equal(projects.remove("nope").kind, "unknown");
  });

  it("tells the subscriber about every change and nothing else", () => {
    const { store: projects } = store();
    let changes = 0;
    const unsubscribe = projects.subscribe(() => {
      changes += 1;
    });

    const project = created(projects, "/code/platform");
    projects.update(project.id, { name: "Другое", archived: true });
    projects.remove(project.id);
    projects.remove("nope");
    projects.list();

    assert.equal(changes, 3);

    unsubscribe();
    created(projects, "/code/second");

    assert.equal(changes, 3);
  });
});

describe("a file that cannot be read", () => {
  it("refuses every write instead of silently forgetting the list", () => {
    // Пустой набор означал бы, что платформа забыла проекты человека, а следом бодро создала
    // «новые» на тех же папках — проверять уникальность стало бы не с чем.
    const { store: projects } = store("{ not json");

    assert.ok(projects.problem() !== undefined);
    assert.equal(projects.create(draft("/code/platform")).kind, "refused");
    assert.equal(projects.update("any", { name: "Имя", archived: false }).kind, "refused");
    assert.equal(projects.remove("any").kind, "refused");
    assert.ok(records.some((record) => record.level === "error"));
  });

  it("does not overwrite the file it could not read", () => {
    const { store: projects, directory } = store("{ not json");

    projects.create(draft("/code/platform"));

    assert.equal(readFileSync(join(directory, projectsFileName), "utf8"), "{ not json");
  });

  it("still offers the ephemeral project: it does not live in the file", () => {
    const { store: projects } = store("{ not json");

    assert.deepEqual(
      projects.list().map((project) => project.id),
      [ephemeralProjectId],
    );
  });

  it("refuses a record it cannot read at all", () => {
    const { store: projects } = store(
      JSON.stringify({ projects: [{ id: "a", name: "Имя", folder: "/code" }] }),
    );

    assert.ok(projects.problem()?.includes("folderKey"));
  });

  it("refuses two records claiming the same folder", () => {
    const entry = {
      name: "Имя",
      folder: "/code",
      folderKey: "/code",
      archived: false,
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    const { store: projects } = store(
      JSON.stringify({
        projects: [
          { ...entry, id: "a" },
          { ...entry, id: "b" },
        ],
      }),
    );

    assert.ok(projects.problem()?.includes("/code"));
  });

  it("refuses a record that claims the identifier of the ephemeral project", () => {
    // Уронить запись молча нельзя: у неё есть папка, и вместе с записью освободился бы путь под
    // второй проект на ту же папку. Платформа такую запись не пишет — значит, её написали руками.
    const { store: projects } = store(
      JSON.stringify({
        projects: [
          {
            id: ephemeralProjectId,
            name: "Подлог",
            folder: "/code",
            folderKey: "/code",
            archived: false,
            createdAt: "2026-07-29T00:00:00.000Z",
          },
        ],
      }),
    );

    assert.ok(projects.problem()?.includes(ephemeralProjectId));
  });

  it("reads a file written by a newer platform, keeping the fields it knows", () => {
    const { store: projects } = store(
      JSON.stringify({
        projects: [
          {
            id: "a",
            name: "Имя",
            folder: "/code",
            folderKey: "/code",
            archived: false,
            createdAt: "2026-07-29T00:00:00.000Z",
            colour: "red",
          },
        ],
      }),
    );

    assert.equal(projects.problem(), undefined);
    assert.equal(projects.find("a")?.name, "Имя");
  });

  it("treats a missing file as an empty list, not as a problem", () => {
    const { store: projects } = store();

    assert.equal(projects.problem(), undefined);
  });
});
