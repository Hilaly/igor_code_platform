// @vitest-environment jsdom

import { coreEventTypes, type BusStreamEvent } from "@sovereign/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { createFrontendBus } from "../events/bus.ts";
import { fetchUsage } from "./usage-api.ts";
import type { UsageSnapshot } from "./usage-state.ts";
import { useUsage } from "./use-usage.ts";

vi.mock("./usage-api.ts", () => ({ fetchUsage: vi.fn() }));

const changed: BusStreamEvent = {
  index: 8,
  time: "2026-08-08T12:00:00.000Z",
  type: coreEventTypes.sessionsChanged,
  payload: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

it("aborts an obsolete load and ignores its late result", async () => {
  const first = deferred<UsageSnapshot>();
  const second = deferred<UsageSnapshot>();
  vi.mocked(fetchUsage).mockReset();
  const signals: AbortSignal[] = [];
  vi.mocked(fetchUsage).mockImplementationOnce((signal) => {
    if (signal !== undefined) signals.push(signal);
    return first.promise;
  });
  vi.mocked(fetchUsage).mockImplementationOnce((signal) => {
    if (signal !== undefined) signals.push(signal);
    return second.promise;
  });
  const bus = createFrontendBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const view = renderHook(() =>
    useUsage({ enabled: true, stream: "open", bus, onDiagnostic: vi.fn() }),
  );

  await waitFor(() => expect(fetchUsage).toHaveBeenCalledTimes(1));
  act(() => bus.publish(changed));
  await waitFor(() => expect(fetchUsage).toHaveBeenCalledTimes(2));
  expect(signals[0]?.aborted).toBe(true);

  act(() =>
    second.resolve({ catalogComplete: true, listedSessionCount: 0, records: [], problems: [] }),
  );
  await waitFor(() => expect(view.result.current.status).toBe("ready"));

  act(() =>
    first.resolve({ catalogComplete: true, listedSessionCount: 7, records: [], problems: [] }),
  );
  await act(async () => Promise.resolve());

  expect(
    view.result.current.status === "ready" && view.result.current.snapshot.listedSessionCount,
  ).toBe(0);
  view.unmount();
});
