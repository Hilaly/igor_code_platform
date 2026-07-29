import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  coreEventTypes,
  projectPath,
  projectsPath,
  type BusEvent,
  type Project,
  type ProjectsSnapshot,
} from "@sovereign/protocol";

import { createDispatcher } from "./dispatcher.ts";
import { ensureDataDirectory, workDirectoryName } from "./data-directory.ts";
import { createEventBus } from "./event-bus.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createProjectPathNormalizer } from "./project-path.ts";
import { createProjectStore, ephemeralProjectId, projectsFileName } from "./project-store.ts";
import { projectsRoutes, publishProjectChanges } from "./projects.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-projects-route-"));
const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  rmSync(workspace, { recursive: true, force: true });
});

const quietLogger = (): Logger =>
  createLogger({ source: "core", level: () => "debug", write: () => {} });

type Answer = { status: number; body: unknown };

async function serve(contents?: string, sessionCount: (folderKey: string) => number = () => 0) {
  const directory = ensureDataDirectory(mkdtempSync(join(workspace, "case-")));

  if (contents !== undefined) {
    writeFileSync(join(directory, projectsFileName), contents);
  }

  const logger = quietLogger();
  // Один нормализатор на стор и на маршруты: разойдись они, второй проект встал бы на ту же папку.
  const normalizePath = createProjectPathNormalizer({ home: "/home/owner", platform: "linux" });
  const projects = createProjectStore({ directory, logger, normalizePath });
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const events: BusEvent[] = [];

  bus.subscribe((event) => events.push(event));
  publishProjectChanges({ projects, bus });

  const server = createServer(
    createDispatcher({
      routes: projectsRoutes({ projects, logger, normalizePath, sessionCount }),
      logger,
      authenticate: () => ({ kind: "session" as const, id: "the-session" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (method: string, path: string, body?: unknown): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        { host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json" } },
        (incoming) => {
          let text = "";

          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            text += chunk;
          });
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              body: text === "" ? undefined : JSON.parse(text),
            }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });

  return {
    directory,
    events,
    list: () => call("GET", projectsPath),
    create: (body: unknown) => call("POST", projectsPath, body),
    update: (id: string, body: unknown) => call("PUT", projectPath(id), body),
    remove: (id: string) => call("DELETE", projectPath(id)),
  };
}

function snapshotOf(answer: Answer): ProjectsSnapshot {
  return answer.body as ProjectsSnapshot;
}

describe("GET /api/projects", () => {
  it("answers with the ephemeral project alone on a fresh install", async () => {
    const { list, directory } = await serve();
    const answer = await list();
    const snapshot = snapshotOf(answer);

    assert.equal(answer.status, 200);
    assert.deepEqual(snapshot.archived, []);
    assert.equal(snapshot.projects.length, 1);
    assert.deepEqual(snapshot.projects[0], {
      id: ephemeralProjectId,
      name: workDirectoryName,
      folder: join(directory, workDirectoryName),
      folderKey: snapshot.projects[0]?.folderKey,
      archived: false,
      availability: "available",
      sessionCount: 0,
      ephemeral: true,
      createdAt: snapshot.projects[0]?.createdAt,
    });
  });

  it("puts an archived project in its own list, out of the working one", async () => {
    const { list, create, update } = await serve();
    const created = (await create({ folder: "/home/owner/code", name: "Код" })).body as Project;

    await update(created.id, { name: "Код", archived: true });

    const snapshot = snapshotOf(await list());

    assert.deepEqual(
      snapshot.projects.map((project) => project.id),
      [ephemeralProjectId],
    );
    assert.deepEqual(
      snapshot.archived.map((project) => project.id),
      [created.id],
    );
    assert.equal(snapshot.archived[0]?.archived, true);
  });

  it("says a folder that is not there is missing", async () => {
    const { list, create } = await serve();

    await create({ folder: "/home/owner/nowhere", name: "Нет такой" });

    const snapshot = snapshotOf(await list());

    assert.equal(snapshot.projects[1]?.availability, "missing");
  });
});

describe("POST /api/projects", () => {
  it("normalizes the folder before storing it", async () => {
    const { create } = await serve();
    const answer = await create({ folder: "~/code/./platform/", name: "Платформа" });
    const project = answer.body as Project;

    assert.equal(answer.status, 200);
    assert.equal(project.folder, "/home/owner/code/platform");
    assert.equal(project.ephemeral, false);
    assert.equal(project.sessionCount, 0);
  });

  it("refuses a body it cannot read with 400", async () => {
    const { create } = await serve();

    assert.equal((await create({ name: "Без папки" })).status, 400);
    assert.equal((await create({ folder: "/code" })).status, 400);
  });

  it("refuses a path that cannot be a project folder with 400", async () => {
    // Тело разбирается безупречно, не тем оказался путь — это всё ещё ошибка запроса.
    const { create } = await serve();

    assert.equal((await create({ folder: "code/platform", name: "Имя" })).status, 400);
    assert.equal((await create({ folder: "~other/code", name: "Имя" })).status, 400);
  });

  it("refuses a taken folder with 409 and hands back the project that took it", async () => {
    // Тело разбирается безупречно, не то — состояние платформы, поэтому `409`, а не `400`
    // (docs/web-api.md). Занявший отдаётся записью: строкой текста вью не подсветит нужную строку.
    const { create } = await serve();
    const first = (await create({ folder: "/home/owner/code", name: "Первый" })).body as Project;
    const second = await create({ folder: "/home/owner/code/", name: "Второй" });

    assert.equal(second.status, 409);

    const refusal = second.body as { error: string; conflict: Project };

    assert.ok(refusal.error.length > 0);
    assert.equal(refusal.conflict.id, first.id);
  });

  it("refuses a second project on the ephemeral folder", async () => {
    const { create, directory } = await serve();
    const answer = await create({ folder: join(directory, workDirectoryName), name: "Свой" });

    assert.equal(answer.status, 409);
    assert.equal((answer.body as { conflict: Project }).conflict.id, ephemeralProjectId);
  });
});

describe("PUT /api/projects/:id", () => {
  it("renames, archives and restores through one write of the whole record", async () => {
    const { create, update } = await serve();
    const project = (await create({ folder: "/home/owner/code", name: "Код" })).body as Project;
    const archived = await update(project.id, { name: "Другое", archived: true });

    assert.equal(archived.status, 200);
    assert.equal((archived.body as Project).name, "Другое");
    assert.equal((archived.body as Project).archived, true);

    const restored = await update(project.id, { name: "Другое", archived: false });

    assert.equal((restored.body as Project).archived, false);
  });

  it("refuses an unknown project with 404 and a broken body with 400", async () => {
    const { create, update } = await serve();
    const project = (await create({ folder: "/home/owner/code", name: "Код" })).body as Project;

    assert.equal((await update("nope", { name: "Имя", archived: false })).status, 404);
    assert.equal((await update(project.id, { name: "Имя" })).status, 400);
  });

  it("refuses every change to the ephemeral project with 409, renaming included", async () => {
    const { update } = await serve();

    assert.equal((await update(ephemeralProjectId, { name: "Моё", archived: false })).status, 409);
    assert.equal((await update(ephemeralProjectId, { name: "work", archived: true })).status, 409);
  });
});

describe("DELETE /api/projects/:id", () => {
  it("removes the record and answers with what was removed", async () => {
    const { create, remove, list } = await serve();
    const project = (await create({ folder: "/home/owner/code", name: "Код" })).body as Project;
    const answer = await remove(project.id);

    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { id: project.id });
    assert.equal(snapshotOf(await list()).projects.length, 1);
  });

  it("refuses an unknown project with 404 and the ephemeral one with 409", async () => {
    const { remove } = await serve();

    assert.equal((await remove("nope")).status, 404);
    assert.equal((await remove(ephemeralProjectId)).status, 409);
  });

  it("refuses removal while sessions still belong to the project", async () => {
    const { create, remove, list } = await serve(undefined, () => 1);
    const project = (await create({ folder: "/home/owner/code", name: "Код" })).body as Project;

    const answer = await remove(project.id);

    assert.equal(answer.status, 409);
    assert.match((answer.body as { error: string }).error, /session/i);
    assert.equal(
      snapshotOf(await list()).projects.some((one) => one.id === project.id),
      true,
    );
  });
});

describe("a projects file that cannot be read", () => {
  it("refuses every route with 409 instead of answering with an empty list", async () => {
    const { list, create, update, remove } = await serve("{ not json");

    assert.equal((await list()).status, 409);
    assert.equal((await create({ folder: "/home/owner/code", name: "Код" })).status, 409);
    assert.equal((await update("any", { name: "Имя", archived: false })).status, 409);
    assert.equal((await remove("any")).status, 409);
  });

  it("names the reason so the human knows what to fix by hand", async () => {
    const { list } = await serve("{ not json");
    const answer = await list();

    assert.match((answer.body as { error: string }).error, /projects\.json/);
  });
});

describe("publishProjectChanges", () => {
  it("publishes one event per change and none for a request that changed nothing", async () => {
    const { create, update, remove, list, events } = await serve();
    const project = (await create({ folder: "/home/owner/code", name: "Код" })).body as Project;

    await update(project.id, { name: "Другое", archived: true });
    await remove(project.id);
    await list();
    await remove("nope");

    assert.deepEqual(
      events.map((event) => event.type),
      [
        coreEventTypes.projectsChanged,
        coreEventTypes.projectsChanged,
        coreEventTypes.projectsChanged,
      ],
    );
    assert.deepEqual(events[0]?.payload, {});
  });
});
