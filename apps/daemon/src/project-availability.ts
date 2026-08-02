/**
 * Доступность папки проекта (docs/sessions-and-projects.md). Это не ошибка, а состояние проекта:
 * папку переименовали, отмонтировали или удалили, и она может вернуться сама.
 */

import { statSync } from "node:fs";

import { coreEventTypes, type ProjectAvailability } from "@sovereign/protocol";

import type { EventBus } from "./platform/public.ts";
import type { ProjectStore, StoredProject } from "./project-store.ts";

/**
 * Доступно — значит запись по пути есть и это папка. Файл на месте папки считается недоступностью:
 * сессию в нём всё равно не запустить.
 */
export function probeProjectFolder(folder: string): ProjectAvailability {
  try {
    // `throwIfNoEntry` подавляет только `ENOENT`. С отмонтированного тома прилетает `EIO`, из
    // закрытой папки — `EACCES`, и оба по-прежнему бросают, поэтому `try` здесь не лишний.
    return statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true
      ? "available"
      : "missing";
  } catch {
    // Отказ пробы — это и есть ответ: папку, которую нельзя опросить, нельзя и открыть. Человек
    // узнаёт о ней тем же способом, что об удалённой, — состоянием «папка недоступна».
    return "missing";
  }
}

export type ProjectAvailabilityWatcher = {
  of: (projectId: string) => ProjectAvailability;
  /** Остановить опрос. Зовётся при остановке демона. */
  stop: () => void;
};

export type CreateProjectAvailabilityWatcherOptions = {
  projects: Pick<ProjectStore, "list">;
  bus: Pick<EventBus, "publish">;
  probe?: (folder: string) => ProjectAvailability;
  pollIntervalMilliseconds?: number;
  /** Вызывается после события о смене доступности, чтобы пересчитать зависимые источники. */
  onChange?: () => void;
};

/**
 * Пять секунд. Величина выбрана из того, что состояние меняет не платформа, а человек с диском:
 * отмонтировал том — увидел смену на глаз, не заметив паузы. Опрос стоит один `stat` на проект,
 * то есть в масштабе десятка проектов не стоит ничего.
 */
const defaultPollIntervalMilliseconds = 5_000;

/**
 * Наблюдатель за доступностью папок (docs/sessions-and-projects.md). Опрашивает по таймеру и
 * публикует `core.projects.changed` только на расхождение с прошлым значением: тик, ничего не
 * изменивший, обязан молчать, иначе открытая вкладка перезапрашивает список раз в пять секунд
 * вечно.
 *
 * **Почему таймер, а не `fs.watch`.** Проверено запуском (docs/runtime-checks.md, проверка 27):
 * наблюдатель на папке проекта об отмонтировании тома не говорит ничего — ни события, ни `error`,
 * ни `close`, — и о возврате тома тоже молчит. Он не ломается, он просто не про это: `fs.watch`
 * рассказывает об изменениях **внутри** папки, а исчезновение самой папки изменением внутри неё не
 * является. Ради того единственного случая, ради которого наблюдатель и нужен, он бесполезен.
 */
export function createProjectAvailabilityWatcher(
  options: CreateProjectAvailabilityWatcherOptions,
): ProjectAvailabilityWatcher {
  const probe = options.probe ?? probeProjectFolder;
  const states = new Map<string, ProjectAvailability>();

  const probeSafely = (folder: string): ProjectAvailability => {
    try {
      return probe(folder);
    } catch {
      return "missing";
    }
  };

  const recount = (): boolean => {
    const projects = options.projects.list();
    let changed = false;

    for (const project of projects) {
      const state = probeSafely(project.folder);

      if (states.get(project.id) !== state) {
        changed = states.has(project.id) || changed;
        states.set(project.id, state);
      }
    }

    // Пропавшие записи убираются, иначе карта растёт на каждый удалённый проект. Само по себе это
    // не смена доступности: об удалении рассказал тот, кто удалил.
    const live = new Set(projects.map((project) => project.id));

    for (const id of states.keys()) {
      if (!live.has(id)) {
        states.delete(id);
      }
    }

    return changed;
  };

  // Первый счёт — здесь: список обязан знать доступность с первого же запроса, а не с шестой
  // секунды жизни демона.
  recount();

  const timer = setInterval(() => {
    if (recount()) {
      options.bus.publish(coreEventTypes.projectsChanged, {});
      options.onChange?.();
    }
  }, options.pollIntervalMilliseconds ?? defaultPollIntervalMilliseconds);

  // Опрос не повод держать процесс живым: демон завершается по сигналу, а не по последнему таймеру.
  timer.unref();

  return {
    of: (projectId) => {
      const known = states.get(projectId);

      if (known !== undefined) {
        return known;
      }

      // Проект, созданный между тиками, обязан получить состояние сразу: иначе он показывался бы
      // недоступным до первого тика, то есть первые пять секунд после создания.
      const project = options.projects.list().find((one: StoredProject) => one.id === projectId);

      if (project === undefined) {
        return "missing";
      }

      const state = probeSafely(project.folder);

      states.set(projectId, state);

      return state;
    },
    stop: () => clearInterval(timer),
  };
}
