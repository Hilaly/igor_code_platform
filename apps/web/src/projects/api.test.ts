import {
  projectFileResourcesPath,
  projectPath,
  projectsPath,
  type FileResourcesSnapshot,
  type Project,
} from "@sovereign/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  deleteProject,
  fetchProjectFileResources,
  fetchProjectsSnapshot,
  updateProject,
} from "./api.ts";

type Answer = { status: number; body: unknown };

/** Ответ демона подставляется целиком: проверяется разбор отказа, а не сеть. */
function daemon(answer: Answer) {
  const calls: { url: string; init?: RequestInit }[] = [];

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });

    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    });
  });

  return calls;
}

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "b7Kq3xv9pQdT",
  name: "Платформа",
  folder: "/code/platform",
  folderKey: "/code/platform",
  archived: false,
  availability: "available",
  sessionCount: 0,
  ephemeral: false,
  createdAt: "2026-07-29T00:00:00.000Z",
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProjectsSnapshot", () => {
  it("asks the projects route and gives back the snapshot", async () => {
    const calls = daemon({ status: 200, body: { projects: [], archived: [] } });

    await expect(fetchProjectsSnapshot()).resolves.toEqual({ projects: [], archived: [] });
    expect(calls[0]?.url).toBe(projectsPath);
  });

  it("carries the reason of the daemon instead of the bare code", async () => {
    // Отказ файла (`409`) объясняет, что чинить руками — потерять этот текст значит оставить
    // человека с числом (docs/data-directory.md).
    daemon({ status: 409, body: { error: "projects.json is not valid json" } });

    await expect(fetchProjectsSnapshot()).rejects.toThrow("projects.json is not valid json");
  });

  it("names the code when the answer has no reason in it", async () => {
    daemon({ status: 500, body: {} });

    await expect(fetchProjectsSnapshot()).rejects.toThrow("the daemon answered 500");
  });
});

describe("fetchProjectFileResources", () => {
  const snapshot: FileResourcesSnapshot = { revision: 7, resources: [], diagnostics: [] };

  it("asks the exact project file-resources route and carries the abort signal", async () => {
    const calls = daemon({ status: 200, body: snapshot });
    const controller = new AbortController();

    await expect(fetchProjectFileResources("project/one", controller.signal)).resolves.toEqual(
      snapshot,
    );
    expect(calls[0]).toEqual({
      url: projectFileResourcesPath("project/one"),
      init: { signal: controller.signal },
    });
  });

  it("carries the daemon reason when the project resources cannot be read", async () => {
    daemon({ status: 409, body: { error: "the project folder is unavailable" } });

    await expect(fetchProjectFileResources("missing")).rejects.toThrow(
      "the project folder is unavailable",
    );
  });
});

describe("createProject", () => {
  it("sends the draft as json and gives back the record", async () => {
    const created = project();
    const calls = daemon({ status: 200, body: created });
    const outcome = await createProject({ folder: "~/code/platform", name: "Платформа" });

    expect(outcome).toEqual({ kind: "created", project: created });
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ folder: "~/code/platform", name: "Платформа" }),
    );
  });

  it("gives a taken folder back as an outcome, not as an error", async () => {
    // Конфликтная запись нужна вью, чтобы подсветить занявшую строку; через `Error` она не пройдёт.
    const conflict = project({ name: "Первый" });

    daemon({ status: 409, body: { error: "the folder already belongs to a project", conflict } });

    await expect(createProject({ folder: "/code/platform", name: "Второй" })).resolves.toEqual({
      kind: "taken",
      error: "the folder already belongs to a project",
      conflict,
    });
  });

  it("still throws on a 409 that is about the file, not about the folder", async () => {
    daemon({ status: 409, body: { error: "projects.json is not valid json" } });

    await expect(createProject({ folder: "/code", name: "Имя" })).rejects.toThrow(
      "projects.json is not valid json",
    );
  });

  it("throws with the reason when the path is not a project folder", async () => {
    daemon({ status: 400, body: { error: "the project folder must be an absolute path" } });

    await expect(createProject({ folder: "code", name: "Имя" })).rejects.toThrow(
      "must be an absolute path",
    );
  });
});

describe("updateProject", () => {
  it("writes the whole record to the project route", async () => {
    const calls = daemon({ status: 200, body: project({ archived: true }) });

    await updateProject("b7Kq3xv9pQdT", { name: "Платформа", archived: true });

    expect(calls[0]?.url).toBe(projectPath("b7Kq3xv9pQdT"));
    expect(calls[0]?.init?.method).toBe("PUT");
  });

  it("carries the refusal of the ephemeral project", async () => {
    daemon({ status: 409, body: { error: "the ephemeral project cannot be renamed" } });

    await expect(updateProject("work", { name: "Моё", archived: false })).rejects.toThrow(
      "the ephemeral project cannot be renamed",
    );
  });
});

describe("deleteProject", () => {
  it("names itself json even without a body: the dispatcher asks for it", async () => {
    // Второй замок против межсайтового запроса (docs/web-api.md) стоит на всяком изменяющем.
    const calls = daemon({ status: 200, body: { id: "b7Kq3xv9pQdT" } });

    await expect(deleteProject("b7Kq3xv9pQdT")).resolves.toEqual({ id: "b7Kq3xv9pQdT" });
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect((calls[0]?.init?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });
});
