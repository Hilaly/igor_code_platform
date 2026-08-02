/**
 * Запросы вью проектов. Источник истины — демон и `projects.json` за ним
 * (docs/data-directory.md): вью не держит своей копии списка, а спрашивает и пишет.
 */

import {
  filesystemPath,
  filesystemQueryParameter,
  projectPath,
  projectsPath,
  type FilesystemListing,
  type Project,
  type ProjectDeleted,
  type ProjectDraft,
  type ProjectUpdate,
  type ProjectsSnapshot,
} from "@sovereign/protocol";

export async function fetchProjectsSnapshot(signal?: AbortSignal): Promise<ProjectsSnapshot> {
  const response = await fetch(projectsPath, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProjectsSnapshot;
}

/**
 * Листинг каталога для проводника выбора папки. Не выбрасывает: ошибка чтения (нет доступа, нет
 * такого пути) возвращается текстом, и пикер показывает её внутри себя, не закрываясь — человек
 * выбирает другую папку, не открывая пикер заново.
 */
export async function fetchFilesystemListing(
  path: string,
  signal?: AbortSignal,
): Promise<FilesystemListing> {
  const query = `${filesystemPath}?${filesystemQueryParameter}=${encodeURIComponent(path)}`;
  const response = await fetch(query, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as FilesystemListing;
}

export type CreateProjectOutcome =
  | { kind: "created"; project: Project }
  /**
   * Папка уже за другим проектом. Отдельный исход, а не исключение: конфликтная запись нужна вью,
   * чтобы подсветить занявшую строку, а через `Error` она не проходит (прецедент — `probeSession`).
   */
  | { kind: "taken"; error: string; conflict: Project };

export async function createProject(draft: ProjectDraft): Promise<CreateProjectOutcome> {
  const response = await fetch(projectsPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });

  if (response.ok) {
    return { kind: "created", project: (await response.json()) as Project };
  }

  const failure = (await response.json().catch(() => ({}))) as {
    error?: string;
    conflict?: Project;
  };

  if (response.status === 409 && failure.conflict !== undefined) {
    return {
      kind: "taken",
      error: failure.error ?? "the folder already belongs to a project",
      conflict: failure.conflict,
    };
  }

  throw new Error(failure.error ?? `the daemon answered ${response.status}`);
}

/** Переименование, архивация и восстановление — одна запись целой записи (docs/web-api.md). */
export async function updateProject(id: string, update: ProjectUpdate): Promise<Project> {
  const response = await fetch(projectPath(id), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as Project;
}

export async function deleteProject(id: string): Promise<ProjectDeleted> {
  // Заголовок нужен и здесь: у `DELETE` тела нет, но диспетчер требует его от всякого изменяющего
  // запроса (docs/web-api.md) — двойной замок против межсайтового запроса.
  const response = await fetch(projectPath(id), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(await reasonOf(response));
  }

  return (await response.json()) as ProjectDeleted;
}

/** Демон отвечает `{"error"}` на любой отказ (docs/web-api.md), но код без тела тоже возможен. */
async function reasonOf(response: Response): Promise<string> {
  const failure = (await response.json().catch(() => ({}))) as { error?: string };

  return failure.error ?? `the daemon answered ${response.status}`;
}
