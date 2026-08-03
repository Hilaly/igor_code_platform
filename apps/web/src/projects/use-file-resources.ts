/**
 * Один снимок файловых ресурсов открытого проекта. Хук пользуется общей шиной и не открывает своего
 * потока; смена проекта отменяет прежний запрос и сбрасывает показанное.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { fetchProjectFileResources } from "./api.ts";
import {
  applyContributionEvent,
  applyFileResourcesFailure,
  applyFileResourcesSnapshot,
  initialFileResourcesState,
  type FileResourcesState,
} from "./file-resources-state.ts";

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function useFileResources(
  projectId: string | undefined,
  bus: Pick<FrontendBus, "subscribe">,
  stream: StreamStatus,
  onDiagnostic: (diagnostic: string) => void,
): FileResourcesState {
  const [state, setState] = useState<FileResourcesState>(initialFileResourcesState);
  const latest = useRef<FileResourcesState>(initialFileResourcesState);
  const pending = useRef<AbortController | undefined>(undefined);
  const sequence = useRef(0);

  const apply = useCallback((next: (current: FileResourcesState) => FileResourcesState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  const reload = useCallback(() => {
    if (projectId === undefined || stream !== "open") {
      return;
    }

    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const requestSequence = sequence.current + 1;
    sequence.current = requestSequence;

    void fetchProjectFileResources(projectId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }

        apply((current) => applyFileResourcesSnapshot(current, snapshot));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }

        const reason = reasonOf(cause);
        onDiagnostic(`the file resources of project ${projectId} could not be read: ${reason}`);
        apply((current) => applyFileResourcesFailure(current, reason));
      });
  }, [apply, onDiagnostic, projectId, stream]);

  useEffect(() => {
    pending.current?.abort();
    pending.current = undefined;
    sequence.current += 1;
    latest.current = initialFileResourcesState;
    setState(initialFileResourcesState);

    if (projectId !== undefined && stream === "open") {
      reload();
    }

    return () => pending.current?.abort();
  }, [projectId, reload, stream]);

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      const outcome = applyContributionEvent(latest.current, event);
      apply(() => outcome.state);

      if (outcome.refetch) {
        reload();
      }
    });

    return unsubscribe;
  }, [apply, bus, reload]);

  return state;
}
