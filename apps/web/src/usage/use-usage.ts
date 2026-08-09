import { coreEventTypes, streamGapType } from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { fetchUsage } from "./usage-api.ts";
import { initialUsageState, receiveUsage, usageFailed, type UsageState } from "./usage-state.ts";

export type UseUsageOptions = {
  enabled: boolean;
  stream: StreamStatus;
  bus: Pick<FrontendBus, "subscribe">;
  onDiagnostic: (diagnostic: string) => void;
};

export function useUsage({ enabled, stream, bus, onDiagnostic }: UseUsageOptions): UsageState {
  const [state, setState] = useState<UsageState>(initialUsageState);
  const pending = useRef<AbortController | undefined>(undefined);
  const report = useRef(onDiagnostic);
  report.current = onDiagnostic;

  const reload = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState(initialUsageState);

    void fetchUsage(controller.signal)
      .then((snapshot) => {
        if (!controller.signal.aborted) setState((current) => receiveUsage(current, snapshot));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const failure = cause instanceof Error ? cause.message : String(cause);
        report.current(`usage analytics could not be read: ${failure}`);
        setState((current) => usageFailed(current, failure));
      });
  }, []);

  useEffect(() => {
    if (!enabled || stream !== "open") return;

    reload();
    const unsubscribe = bus.subscribe((event) => {
      if (event.type === coreEventTypes.sessionsChanged || event.type === streamGapType) reload();
    });

    return () => {
      unsubscribe();
      pending.current?.abort();
    };
  }, [bus, enabled, reload, stream]);

  return state;
}
