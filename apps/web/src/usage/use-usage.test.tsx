// @vitest-environment jsdom

import { coreEventTypes, streamGapType, type BusStreamEvent } from "@sovereign/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { createFrontendBus } from "../events/bus.ts";
import { useUsage } from "./use-usage.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => vi.unstubAllGlobals());

const event = (type: string): BusStreamEvent =>
  ({
    index: 8,
    time: "2026-08-08T12:00:00.000Z",
    type,
    payload: type === streamGapType ? { requestedIndex: 2, oldestIndex: 8 } : {},
  }) as BusStreamEvent;

it("loads only while the usage section is active and refreshes after session changes or a gap", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const path = String(input);
    if (path === "/api/sessions" || path === "/api/sessions?archived=true") {
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    }
    throw new Error(`unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const bus = createFrontendBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const diagnostics: string[] = [];
  const view = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useUsage({
        enabled,
        stream: "open",
        bus,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    { initialProps: { enabled: false } },
  );

  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender({ enabled: true });
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  expect(fetchMock).toHaveBeenCalledTimes(2);

  act(() => bus.publish(event(coreEventTypes.sessionsChanged)));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

  act(() => bus.publish(event(streamGapType)));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
  expect(diagnostics).toEqual([]);
  view.unmount();
});
