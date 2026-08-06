/**
 * Проекты через веб-API (docs/web-api.md). Маршрут своего состояния не держит: список живёт в
 * `project-store.ts`, доступность считается наблюдателем, а здесь собирается ответ.
 *
 * Здесь же публикация `core.projects.changed`: список меняется и запросом, и сам по себе — папка
 * может пропасть без всякого запроса, — и открытый браузер обязан узнать об этом без перезапроса.
 */

import {
  coreEventTypes,
  parseProjectDraft,
  parseProjectUpdate,
  projectPathPattern,
  projectsPath,
  type Project,
  type ProjectAvailability,
  type ProjectsSnapshot,
} from "@sovereign/protocol";

import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { EventBus } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";
import type { ProjectLifecycle } from "./project-lifecycle.ts";
import { probeProjectFolder } from "./project-availability.ts";
import { normalizeProjectPath, type ProjectPathNormalizer } from "./project-path.ts";
import { ephemeralProjectId, type ProjectStore, type StoredProject } from "./project-store.ts";

export type ProjectsRouteOptions = {
  projects: ProjectStore;
  logger: Logger;
  /**
   * Откуда брать доступность. По умолчанию — прямая проба диска; демон подставляет сюда счёт
   * наблюдателя, чтобы список не стоил `stat` на каждый запрос.
   */
  availability?: (project: StoredProject) => ProjectAvailability;
  /** Тот же нормализатор, что у стора: складка обязана быть общей (`project-path.ts`). */
  normalizePath?: ProjectPathNormalizer;
  /**
   * Сколько сессий в папке проекта. По умолчанию ноль: маршрут проектов поднимается и без службы
   * сессий, а «пропадёт 0 сессий» вью говорит честно (docs/sessions-and-projects.md).
   */
  sessionCount?: (folderKey: string) => number;
  projectLifecycle?: ProjectLifecycle;
  /**
   * Запись проекта удалена безвозвратно. Нужен тем, кто держит состояние по идентификатору проекта:
   * хранилища плагинов из его папки уходят вместе с ним, иначе директория данных копит состояние
   * плагинов из папок, которых больше нет (docs/plugins.md).
   */
  onRemoved?: (projectId: string) => void;
};

export function projectsRoutes(options: ProjectsRouteOptions): Route[] {
  const { projects, logger } = options;
  const availabilityOf = options.availability ?? ((project) => probeProjectFolder(project.folder));
  const normalizePath = options.normalizePath ?? ((raw) => normalizeProjectPath(raw));
  const sessionCount = options.sessionCount ?? (() => 0);
  const projectLifecycle: ProjectLifecycle = options.projectLifecycle ?? {
    run: async (_projectId, operation) => operation(),
  };

  const describe = (project: StoredProject): Project => ({
    id: project.id,
    name: project.name,
    folder: project.folder,
    folderKey: project.folderKey,
    archived: project.archived,
    availability: availabilityOf(project),
    // Считается по заголовкам файлов сессий, без чтения записей: принадлежность выражена папкой
    // (docs/sessions-and-projects.md), поэтому сравнение идёт по тому же `folderKey`.
    sessionCount: sessionCount(project.folderKey),
    ephemeral: project.id === ephemeralProjectId,
    createdAt: project.createdAt,
  });

  /**
   * Отказ файла — не ошибка запроса и не поломка демона: список проектов на диске негоден, и
   * разобраться с этим может только человек (docs/data-directory.md).
   */
  const refuseUnreadableFile = (response: Parameters<typeof respondWithError>[0]): boolean => {
    const problem = projects.problem();

    if (problem === undefined) {
      return false;
    }

    respondWithError(response, 409, problem);

    return true;
  };

  return [
    {
      method: "GET",
      path: projectsPath,
      handle: ({ response }) => {
        if (refuseUnreadableFile(response)) {
          return;
        }

        const described = projects.list().map(describe);
        // Два списка, а не один с флагом: архивные показываются отдельно, и клиент читает в той
        // форме, в которой рисует (docs/sessions-and-projects.md).
        const snapshot: ProjectsSnapshot = {
          projects: described.filter((project) => !project.archived),
          archived: described.filter((project) => project.archived),
        };

        respondWithJson(response, 200, snapshot);
      },
    },
    {
      method: "POST",
      path: projectsPath,
      handle: ({ response, body }) => {
        const parsed = parseProjectDraft(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        const normalized = normalizePath(parsed.value.folder);

        // Путь, который не может быть папкой проекта, — всё ещё ошибка запроса: его прислал клиент,
        // и повтор того же запроса кончится тем же.
        if (normalized.kind === "rejected") {
          respondWithError(response, 400, normalized.reason);

          return;
        }

        if (refuseUnreadableFile(response)) {
          return;
        }

        const created = projects.create({
          name: parsed.value.name,
          folder: normalized.value.folder,
          folderKey: normalized.value.folderKey,
        });

        if (created.kind === "refused") {
          respondWithError(response, 409, created.reason);

          return;
        }

        // Занявший проект отдаётся записью, а не именем в тексте: спецификация требует «отклоняется
        // с указанием на существующий» (docs/sessions-and-projects.md), а строкой вью не подсветит
        // нужную строку списка.
        if (created.kind === "taken") {
          respondWithJson(response, 409, {
            error: `the folder ${normalized.value.folder} already belongs to a project`,
            conflict: describe(created.conflict),
          });

          return;
        }

        respondWithJson(response, 200, describe(created.project));
      },
    },
    {
      method: "PUT",
      path: projectPathPattern,
      handle: ({ response, body, parameters }) => {
        const parsed = parseProjectUpdate(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        const updated = projects.update(parameters["id"] ?? "", parsed.value);

        if (updated.kind === "unknown") {
          respondWithError(response, 404, "not found");

          return;
        }

        if (updated.kind === "ephemeral") {
          respondWithError(
            response,
            409,
            "the ephemeral project cannot be renamed, archived or removed",
          );

          return;
        }

        if (updated.kind === "refused") {
          respondWithError(response, 409, updated.reason);

          return;
        }

        respondWithJson(response, 200, describe(updated.project));
      },
    },
    {
      method: "DELETE",
      path: projectPathPattern,
      handle: async ({ response, parameters }) => {
        const id = parameters["id"] ?? "";
        if (refuseUnreadableFile(response)) {
          return;
        }

        await projectLifecycle.run(id, () => {
          const existing = projects.find(id);

          if (existing === undefined) {
            respondWithError(response, 404, "not found");

            return;
          }

          if (existing.id === ephemeralProjectId) {
            respondWithError(
              response,
              409,
              "the ephemeral project cannot be renamed, archived or removed",
            );

            return;
          }

          const count = sessionCount(existing.folderKey);

          if (count > 0) {
            respondWithError(
              response,
              409,
              `the project still has ${count} session${count === 1 ? "" : "s"}; remove sessions first`,
            );

            return;
          }

          const removed = projects.remove(id);

          if (removed.kind === "unknown") {
            respondWithError(response, 404, "not found");

            return;
          }

          if (removed.kind === "ephemeral") {
            respondWithError(
              response,
              409,
              "the ephemeral project cannot be renamed, archived or removed",
            );

            return;
          }

          if (removed.kind === "refused") {
            respondWithError(response, 409, removed.reason);

            return;
          }

          // Папку пользователя платформа не удаляет никогда (docs/sessions-and-projects.md): уходит
          // запись, а не работа.
          options.onRemoved?.(id);
          logger.info("a project record was removed", { project: id });
          respondWithJson(response, 200, { id });
        });
      },
    },
  ];
}

export type PublishProjectChangesOptions = {
  projects: Pick<ProjectStore, "subscribe">;
  bus: Pick<EventBus, "publish">;
};

/**
 * Стор про шину не знает: он хранит записи, а кто и зачем о них слушает — не его дело. Возвращает
 * функцию отписки.
 */
export function publishProjectChanges(options: PublishProjectChangesOptions): () => void {
  return options.projects.subscribe(() => {
    options.bus.publish(coreEventTypes.projectsChanged, {});
  });
}
