/**
 * Состояние вью проектов и его правила. Логика живёт здесь, а не в хуке, потому что проверяется она
 * тестом, а не глазами.
 *
 * Событий тут разбирать почти нечего: `core.projects.changed` нагрузки не несёт вовсе
 * (docs/event-bus.md), и всякий кадр означает одно — перезапросить список.
 */

import {
  coreEventTypes,
  isPluginStreamEvent,
  streamGapType,
  type Project,
  type ProjectsSnapshot,
  type BusStreamEvent,
} from "@sovereign/protocol";

export type ProjectsState = {
  snapshot?: ProjectsSnapshot;
  /** Часть потока пропущена: показанное могло устареть (docs/web-api.md). */
  stale: boolean;
  /** Почему список не прочитан или запись не прошла. Разбираться с этим человеку. */
  failure?: string;
  /**
   * Папка, на которую проект уже есть, вместе с текстом отказа. Не `failure`, потому что показать
   * её надо не строкой, а указанием на занявшую строку списка (docs/sessions-and-projects.md).
   */
  conflict?: { error: string; project: Project };
};

export const initialProjectsState: ProjectsState = { stale: false };

export type StreamOutcome = {
  state: ProjectsState;
  refetch: boolean;
};

export function applyStreamEvent(state: ProjectsState, event: BusStreamEvent): StreamOutcome {
  // События плагинов вью не касаются.
  if (isPluginStreamEvent(event)) {
    return { state, refetch: false };
  }

  if (event.type === streamGapType) {
    return { state: { ...state, stale: true }, refetch: true };
  }

  // Одно событие на всё: создание, переименование, архивацию, восстановление, удаление и смену
  // доступности. Что именно изменилось, в кадре не написано — и не должно быть: доступность папки
  // меняется сама по себе и успела бы устареть к моменту доставки.
  return { state, refetch: event.type === coreEventTypes.projectsChanged };
}

/**
 * Ответ применяется целиком и всегда. Порядок обеспечивается не полем в снимке, а тем, что запрос
 * один в полёте: предыдущий отменяется (`use-projects.ts`), поэтому двум ответам разойтись негде.
 */
export function applySnapshot(state: ProjectsState, snapshot: ProjectsSnapshot): ProjectsState {
  return { ...state, snapshot, stale: false, failure: undefined };
}

export function applyFailure(state: ProjectsState, reason: string): ProjectsState {
  return { ...state, failure: reason };
}

export function applyConflict(
  state: ProjectsState,
  conflict: { error: string; project: Project },
): ProjectsState {
  return { ...state, conflict, failure: undefined };
}

/** Отказ и конфликт снимаются вместе: человек начал новое действие, старая жалоба к нему не про то. */
export function clearComplaints(state: ProjectsState): ProjectsState {
  return { ...state, failure: undefined, conflict: undefined };
}

/**
 * Переименование и архивация применяются оптимистично: человек видит результат сразу, а ответ
 * переприменит то же самое. Создание и удаление так нельзя — их результат это идентификатор
 * записи, а придумывать его на клиенте значит выдумывать состояние сервера.
 */
export function applyLocalUpdate(
  state: ProjectsState,
  id: string,
  update: { name: string; archived: boolean },
): ProjectsState {
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return state;
  }

  const all = [...snapshot.projects, ...snapshot.archived].map((project) =>
    project.id === id ? { ...project, ...update } : project,
  );

  return {
    ...state,
    failure: undefined,
    conflict: undefined,
    snapshot: {
      projects: ordered(all.filter((project) => !project.archived)),
      archived: ordered(all.filter((project) => project.archived)),
    },
  };
}

/**
 * Тот же порядок, в котором отдаёт демон: эфемерный первым, дальше по времени создания. Считается
 * заново, а не берётся из прежнего списка: архивация переносит запись между списками, и порядок,
 * взятый из уже переставленного списка, деградировал бы с каждым переносом — восстановленный
 * проект уезжал бы в конец.
 */
function ordered(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    if (left.ephemeral !== right.ephemeral) {
      return left.ephemeral ? -1 : 1;
    }

    return left.createdAt < right.createdAt ? -1 : 1;
  });
}
