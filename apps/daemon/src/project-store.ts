/**
 * Записи проектов на диске (docs/sessions-and-projects.md, docs/data-directory.md). Файл читается
 * один раз при старте и дальше живёт в памяти: пишет его только этот модуль, а спрашивают список на
 * каждом запросе к вью проектов и на каждом обходе корней плагинов.
 *
 * Доступности папки в файле нет: она свойство мира, а не записи, и считает её наблюдатель. Числа
 * сессий нет: оно придёт вместе с хранилищем сессий.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ProjectUpdate } from "@sovereign/protocol";

import { writeFileAtomically } from "./platform/public.ts";
import { workDirectoryName } from "./platform/public.ts";
import type { Logger } from "./platform/public.ts";
import { normalizeProjectPath, type ProjectPathNormalizer } from "./project-path.ts";

export const projectsFileName = "projects.json";

/**
 * Идентификатор эфемерного проекта. Константа, а не случайная строка: он едет в путь маршрута и
 * обязан переживать перезапуск, а взяться заново ему неоткуда — записи на диске у эфемерного
 * проекта нет.
 */
export const ephemeralProjectId = "work";

/** Идентификатор записи: 12 символов base64url. Длины хватает, в путь он влезает без кодирования. */
const identifierLengthBytes = 9;

/** Запись, как она лежит в файле. Доступность и число сессий приписываются при сборке ответа. */
export type StoredProject = {
  id: string;
  name: string;
  folder: string;
  folderKey: string;
  archived: boolean;
  createdAt: string;
};

export type ProjectDraftRecord = {
  name: string;
  /** Уже нормализованные (`project-path.ts`): стор не знает про файловую систему. */
  folder: string;
  folderKey: string;
};

export type CreateProjectOutcome =
  | { kind: "created"; project: StoredProject }
  /** На эту папку проект уже есть. Отдаётся он сам: отказ обязан называть занявшего. */
  | { kind: "taken"; conflict: StoredProject }
  | { kind: "refused"; reason: string };

export type UpdateProjectOutcome =
  | { kind: "updated"; project: StoredProject }
  | { kind: "unknown" }
  /** Эфемерный проект не переименовывается, не архивируется и не удаляется. */
  | { kind: "ephemeral" }
  | { kind: "refused"; reason: string };

export type RemoveProjectOutcome =
  | { kind: "removed" }
  | { kind: "unknown" }
  | { kind: "ephemeral" }
  | { kind: "refused"; reason: string };

export type ProjectStore = {
  /** Эфемерный первым, дальше — в порядке создания. */
  list: () => StoredProject[];
  find: (id: string) => StoredProject | undefined;
  findByFolderKey: (folderKey: string) => StoredProject | undefined;
  create: (draft: ProjectDraftRecord) => CreateProjectOutcome;
  update: (id: string, update: ProjectUpdate) => UpdateProjectOutcome;
  remove: (id: string) => RemoveProjectOutcome;
  /** Почему файл не читается, если не читается. Маршруты отвечают по нему отказом. */
  problem: () => string | undefined;
  /** Изменился список. Возвращает функцию отписки. */
  subscribe: (listener: () => void) => () => void;
};

export type CreateProjectStoreOptions = {
  directory: string;
  logger: Logger;
  /**
   * Тот же нормализатор, что у маршрутов: ключ папки эфемерного проекта обязан складываться так же,
   * как ключ создаваемого, иначе проект встанет на папку `work` вторым.
   */
  normalizePath?: ProjectPathNormalizer;
  now?: () => number;
};

export function createProjectStore(options: CreateProjectStoreOptions): ProjectStore {
  const path = join(options.directory, projectsFileName);
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  const ephemeral = describeEphemeralProject(
    options.directory,
    options.normalizePath ?? ((raw) => normalizeProjectPath(raw)),
  );
  const file = readProjects(path, options.logger);

  let projects = file.kind === "read" ? file.projects : [];

  const announce = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const write = (next: StoredProject[]): void => {
    writeFileAtomically(path, `${JSON.stringify({ projects: next }, undefined, 2)}\n`);
    projects = next;
    announce();
  };

  return {
    list: () => [ephemeral, ...projects],
    find: (id) => (id === ephemeralProjectId ? ephemeral : projects.find((one) => one.id === id)),
    findByFolderKey: (folderKey) =>
      ephemeral.folderKey === folderKey
        ? ephemeral
        : projects.find((one) => one.folderKey === folderKey),
    create: (draft) => {
      if (file.kind === "refused") {
        return { kind: "refused", reason: file.reason };
      }

      const conflict =
        ephemeral.folderKey === draft.folderKey
          ? ephemeral
          : projects.find((one) => one.folderKey === draft.folderKey);

      if (conflict !== undefined) {
        return { kind: "taken", conflict };
      }

      const project: StoredProject = {
        id: randomBytes(identifierLengthBytes).toString("base64url"),
        name: draft.name,
        folder: draft.folder,
        folderKey: draft.folderKey,
        archived: false,
        createdAt: new Date(now()).toISOString(),
      };

      write([...projects, project]);

      return { kind: "created", project };
    },
    update: (id, update) => {
      if (id === ephemeralProjectId) {
        return { kind: "ephemeral" };
      }

      if (file.kind === "refused") {
        return { kind: "refused", reason: file.reason };
      }

      const previous = projects.find((one) => one.id === id);

      if (previous === undefined) {
        return { kind: "unknown" };
      }

      // Папка не меняется никогда (docs/sessions-and-projects.md), поэтому и ключ остаётся прежним.
      const project: StoredProject = { ...previous, name: update.name, archived: update.archived };

      write(projects.map((one) => (one.id === id ? project : one)));

      return { kind: "updated", project };
    },
    remove: (id) => {
      if (id === ephemeralProjectId) {
        return { kind: "ephemeral" };
      }

      if (file.kind === "refused") {
        return { kind: "refused", reason: file.reason };
      }

      if (!projects.some((one) => one.id === id)) {
        return { kind: "unknown" };
      }

      write(projects.filter((one) => one.id !== id));

      return { kind: "removed" };
    },
    problem: () => (file.kind === "refused" ? file.reason : undefined),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}

/**
 * Эфемерный проект синтезируется, а не читается: записи на диске у него нет вовсе — что слово
 * «эфемерный» и значит. Имя даётся папкой, а показывает человеку локализованное вью: `name` здесь
 * нужен тем, кто смотрит ответ маршрута в терминале.
 */
function describeEphemeralProject(
  directory: string,
  normalizePath: ProjectPathNormalizer,
): StoredProject {
  const folder = join(directory, workDirectoryName);
  const normalized = normalizePath(folder);

  return {
    id: ephemeralProjectId,
    name: workDirectoryName,
    folder,
    // Отказ здесь невозможен: путь собран из абсолютной директории данных. Но обрабатывать его
    // молчанием нельзя, и лексический ключ — честный запасной вариант.
    folderKey: normalized.kind === "normalized" ? normalized.value.folderKey : folder,
    archived: false,
    createdAt: createdAtOf(folder),
  };
}

/** Дата создания папки: другой у эфемерного проекта нет, а поле есть у всех записей. */
function createdAtOf(folder: string): string {
  const entry = statSync(folder, { throwIfNoEntry: false });

  return new Date(entry?.birthtime ?? Date.now()).toISOString();
}

type ProjectsFile =
  { kind: "read"; projects: StoredProject[] } | { kind: "refused"; reason: string };

/**
 * Негодный файл — отказ, а не пустой набор, в отличие от сессий входа: под `projects.json` лежат
 * решения человека. Пустой набор означал бы, что платформа молча забыла список проектов, а следом
 * бодро создала «новые» проекты на тех же папках — проверять уникальность стало бы не с чем
 * (docs/data-directory.md, «Ручное восстановление»).
 */
function readProjects(path: string, logger: Logger): ProjectsFile {
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return { kind: "read", projects: [] };
    }

    throw cause;
  }

  const refuse = (reason: string): ProjectsFile => {
    logger.error("the projects file was not applied and every project route will refuse", {
      file: projectsFileName,
      reason,
    });

    return { kind: "refused", reason };
  };

  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return refuse(
      `${projectsFileName} is not valid json: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const stored =
    typeof document === "object" && document !== null && !Array.isArray(document)
      ? (document as Record<string, unknown>)["projects"]
      : undefined;

  if (!Array.isArray(stored)) {
    return refuse(`${projectsFileName} does not hold a list of projects`);
  }

  const projects: StoredProject[] = [];
  const seen = new Set<string>();

  for (const entry of stored) {
    const problem = describeRecordProblem(entry);

    if (problem !== undefined) {
      return refuse(`${projectsFileName}: ${problem}`);
    }

    const project = entry as StoredProject;

    if (seen.has(project.folderKey)) {
      return refuse(
        `${projectsFileName}: two projects claim the folder ${JSON.stringify(project.folderKey)}`,
      );
    }

    seen.add(project.folderKey);
    projects.push({
      id: project.id,
      name: project.name,
      folder: project.folder,
      folderKey: project.folderKey,
      archived: project.archived,
      createdAt: project.createdAt,
    });
  }

  return { kind: "read", projects };
}

/**
 * Одна негодная запись роняет файл целиком, как у настроек: выборочное чтение означало бы, что
 * платформа сама решила, какой из проектов человека забыть.
 *
 * Неизвестное поле при этом не проблема — файл, написанный более новой платформой, обязан читаться
 * старой; лишние поля просто не переносятся в память.
 */
function describeRecordProblem(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "a project record is not an object";
  }

  const fields = raw as Record<string, unknown>;

  for (const required of ["id", "name", "folder", "folderKey", "createdAt"]) {
    if (typeof fields[required] !== "string" || fields[required] === "") {
      return `a project record has no readable ${required}`;
    }
  }

  if (typeof fields["archived"] !== "boolean") {
    return "a project record has no readable archived";
  }

  // Запись с идентификатором эфемерного проекта платформа не пишет, значит её написали руками.
  // Уронить её молча нельзя: у неё есть папка, и вместе с записью освободился бы путь под второй
  // проект на ту же папку.
  if (fields["id"] === ephemeralProjectId) {
    return `a project record claims the reserved identifier ${JSON.stringify(ephemeralProjectId)}`;
  }

  return undefined;
}
