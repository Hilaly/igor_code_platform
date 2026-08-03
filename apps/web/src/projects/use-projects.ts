/**
 * Связь вью проектов с демоном: снимок на подъёме соединения, кадры из фронтовой шины, записи
 * человека. Своего потока вью не открывает — соединение одно на вкладку (docs/web-api.md).
 *
 * Порядок именно такой: снимок спрашивается после того, как поток открылся. Наоборот потерялись бы
 * события, случившиеся между ответом и подпиской.
 */

import type { ProjectDraft, ProjectUpdate } from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { createProject, deleteProject, fetchProjectsSnapshot, updateProject } from "./api.ts";
import {
  applyConflict,
  applyFailure,
  applyLocalUpdate,
  applySnapshot,
  applyStreamEvent,
  clearComplaints,
  initialProjectsState,
  type ProjectsState,
} from "./state.ts";

export type UseProjectsOptions = {
  bus: Pick<FrontendBus, "subscribe">;
  stream: StreamStatus;
  onDiagnostic: (diagnostic: string) => void;
};

export type ProjectsController = {
  state: ProjectsState;
  /** Ответ нужен вызывающему: форма закрывается только после успеха. */
  create: (draft: ProjectDraft) => Promise<boolean>;
  update: (id: string, update: ProjectUpdate) => Promise<string | undefined>;
  remove: (id: string) => Promise<string | undefined>;
  dismissComplaints: () => void;
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function useProjects(options: UseProjectsOptions): ProjectsController {
  const { bus, stream, onDiagnostic } = options;
  const [state, setState] = useState<ProjectsState>(initialProjectsState);

  // То же зеркало, что во вью плагинов: кадры приходят чаще, чем React успевает отрисовать, а
  // правило применения смотрит на предыдущее состояние. Единственный источник изменения — `apply`.
  const latest = useRef<ProjectsState>(initialProjectsState);
  const apply = useCallback((next: (current: ProjectsState) => ProjectsState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  const pending = useRef<AbortController | undefined>(undefined);

  // Номер записи на проект: два быстрых переименования рвут договор, если первый ответ приходит
  // последним и возвращает то, что человек уже переписал.
  const writeSeq = useRef<Map<string, number>>(new Map());

  const reload = useCallback(() => {
    pending.current?.abort();

    const controller = new AbortController();
    pending.current = controller;

    void fetchProjectsSnapshot(controller.signal)
      .then((snapshot) => apply((current) => applySnapshot(current, snapshot)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the projects could not be read: ${reason}`);
        apply((current) => applyFailure(current, reason));
      });
  }, [apply, onDiagnostic]);

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      const outcome = applyStreamEvent(latest.current, event);

      apply(() => outcome.state);

      if (outcome.refetch) {
        reload();
      }
    });

    return unsubscribe;
  }, [apply, bus, reload]);

  useEffect(() => {
    if (stream !== "open") {
      return;
    }

    reload();
  }, [stream, reload]);

  useEffect(() => () => pending.current?.abort(), []);

  const create = useCallback(
    async (draft: ProjectDraft): Promise<boolean> => {
      apply(clearComplaints);

      try {
        // Оптимистично создание не идёт: его результат — идентификатор записи, а выдумывать его на
        // клиенте значит выдумывать состояние сервера.
        const outcome = await createProject(draft);

        if (outcome.kind === "taken") {
          apply((current) =>
            applyConflict(current, { error: outcome.error, project: outcome.conflict }),
          );

          return false;
        }

        reload();

        return true;
      } catch (cause) {
        const reason = reasonOf(cause);

        onDiagnostic(`the project could not be created: ${reason}`);
        apply((current) => applyFailure(current, reason));

        return false;
      }
    },
    [apply, onDiagnostic, reload],
  );

  const update = useCallback(
    async (id: string, next: ProjectUpdate): Promise<string | undefined> => {
      // Переименование и архивация — сразу: человек видит результат, а ответ переприменит то же.
      apply((current) => applyLocalUpdate(current, id, next));

      const seq = (writeSeq.current.get(id) ?? 0) + 1;
      writeSeq.current.set(id, seq);

      try {
        const project = await updateProject(id, next);
        if ((writeSeq.current.get(id) ?? 0) !== seq) {
          return undefined;
        }

        apply((current) =>
          applyLocalUpdate(current, project.id, {
            name: project.name,
            archived: project.archived,
          }),
        );
        return undefined;
      } catch (cause: unknown) {
        if ((writeSeq.current.get(id) ?? 0) !== seq) {
          return undefined;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the project could not be changed: ${reason}`);
        apply((current) => applyFailure(current, reason));
        // Оптимистичное изменение откатывается снимком, а не своей копией прежнего значения:
        // за время запроса запись мог изменить кто-то ещё.
        reload();
        return reason;
      }
    },
    [apply, onDiagnostic, reload],
  );

  const remove = useCallback(
    async (id: string): Promise<string | undefined> => {
      apply(clearComplaints);

      try {
        await deleteProject(id);
        reload();
        return undefined;
      } catch (cause: unknown) {
        const reason = reasonOf(cause);

        onDiagnostic(`the project could not be removed: ${reason}`);
        apply((current) => applyFailure(current, reason));
        return reason;
      }
    },
    [apply, onDiagnostic, reload],
  );

  const dismissComplaints = useCallback(() => apply(clearComplaints), [apply]);

  return { state, create, update, remove, dismissComplaints };
}
