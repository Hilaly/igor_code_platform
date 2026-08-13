/**
 * Контекстные агенты и файловые ресурсы проекта (docs/web-api.md). Предметная область проектов
 * проверяет доступность адресата, а готовые снимки получает через callbacks: внутренности сессий и
 * плагинов не пересекают границу модуля.
 */

import {
  projectAgentsPathPattern,
  projectFileResourcesPathPattern,
  projectFilesPathPattern,
  projectFilesQueryParameter,
  type AgentsSnapshot,
  type FileResourcesSnapshot,
  type ProjectAvailability,
} from "@sovereign/protocol";

import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import { probeProjectFolder } from "./project-availability.ts";
import { searchProjectFiles } from "./project-files.ts";
import type { ProjectStore, StoredProject } from "./project-store.ts";

export type ProjectResourceRouteOptions = {
  projects: Pick<ProjectStore, "find">;
  agents: (projectId: string) => AgentsSnapshot;
  fileResources: (projectId: string) => FileResourcesSnapshot;
  /** Демон подставляет наблюдателя, тест и отдельный маршрут могут пробовать папку напрямую. */
  availability?: (project: StoredProject) => ProjectAvailability;
};

export function projectResourceRoutes(options: ProjectResourceRouteOptions): Route[] {
  const availabilityOf = options.availability ?? ((project) => probeProjectFolder(project.folder));

  const withProject = (
    response: Parameters<typeof respondWithError>[0],
    projectId: string,
    answer: (project: StoredProject) => void,
  ): void => {
    const project = options.projects.find(projectId);

    if (project === undefined) {
      respondWithError(response, 404, "not found");

      return;
    }

    if (project.archived) {
      respondWithError(response, 409, "the project is archived");

      return;
    }

    if (availabilityOf(project) === "missing") {
      respondWithError(response, 409, `the folder ${project.folder} is not there`);

      return;
    }

    answer(project);
  };

  return [
    {
      method: "GET",
      path: projectAgentsPathPattern,
      handle: ({ response, parameters }) => {
        const projectId = parameters["id"] ?? "";
        withProject(response, projectId, () => {
          respondWithJson(response, 200, options.agents(projectId));
        });
      },
    },
    {
      method: "GET",
      path: projectFileResourcesPathPattern,
      handle: ({ response, parameters }) => {
        const projectId = parameters["id"] ?? "";
        withProject(response, projectId, () => {
          respondWithJson(response, 200, options.fileResources(projectId));
        });
      },
    },
    {
      method: "GET",
      path: projectFilesPathPattern,
      handle: ({ response, parameters, url }) => {
        const projectId = parameters["id"] ?? "";
        // Проверки те же, что у остальных ресурсов проекта: архивный и пропавшая папка отсекаются
        // выше, и искать в них нечего.
        withProject(response, projectId, (project) => {
          respondWithJson(
            response,
            200,
            searchProjectFiles({
              folder: project.folder,
              query: url.searchParams.get(projectFilesQueryParameter) ?? "",
            }),
          );
        });
      },
    },
  ];
}
