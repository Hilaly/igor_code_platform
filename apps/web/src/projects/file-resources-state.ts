/** Состояние снимка файловых ресурсов открытого проекта и правила его упорядочивания. */

import {
  coreEventTypes,
  isPluginStreamEvent,
  streamGapType,
  type BusStreamEvent,
  type FileResourcesSnapshot,
} from "@sovereign/protocol";

export type FileResourcesState = {
  snapshot?: FileResourcesSnapshot;
  /** Кадр сообщил, что показанное могло устареть; запрос уже идёт. */
  stale: boolean;
  /** Минимальная ревизия ответа после точной инвалидации. */
  requiredRevision?: number;
  failure?: string;
};

export const initialFileResourcesState: FileResourcesState = { stale: false };

export type ContributionEventOutcome = {
  state: FileResourcesState;
  refetch: boolean;
};

export function applyContributionEvent(
  state: FileResourcesState,
  event: BusStreamEvent,
): ContributionEventOutcome {
  if (isPluginStreamEvent(event)) {
    return { state, refetch: false };
  }

  if (event.type === streamGapType) {
    return { state: { ...state, stale: true }, refetch: true };
  }

  if (event.type !== coreEventTypes.contributionsChanged) {
    return { state, refetch: false };
  }

  return {
    state: {
      ...state,
      stale: true,
      requiredRevision: Math.max(state.requiredRevision ?? 0, event.payload.revision),
    },
    refetch: true,
  };
}

export function applyFileResourcesSnapshot(
  state: FileResourcesState,
  snapshot: FileResourcesSnapshot,
): FileResourcesState {
  const revisionFloor = Math.max(state.requiredRevision ?? 0, state.snapshot?.revision ?? 0);

  if (snapshot.revision < revisionFloor) {
    return state;
  }

  return { snapshot, stale: false };
}

export function applyFileResourcesFailure(
  state: FileResourcesState,
  failure: string,
): FileResourcesState {
  return { ...state, failure };
}
