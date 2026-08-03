// @vitest-environment jsdom

import {
  coreEventTypes,
  projectFileResourcesPath,
  streamGapType,
  type FileResourcesSnapshot,
} from "@sovereign/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { useFileResources } from "./use-file-resources.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Pending = {
  projectId: string;
  signal?: AbortSignal | null;
  resolve: (response: Response) => void;
};

let pending: Pending[];

const response = (snapshot: FileResourcesSnapshot): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(snapshot) }) as Response;

beforeEach(() => {
  pending = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const projectId = url === projectFileResourcesPath("p1") ? "p1" : "p2";

    return new Promise<Response>((resolve) => {
      pending.push({ projectId, signal: init?.signal, resolve });
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

function connect(projectId: string | undefined = "p1", stream: StreamStatus = "open") {
  const bus = createFrontendBus({ onListenerError: (cause) => void cause });
  const diagnostics: string[] = [];
  const record = (message: string): void => {
    diagnostics.push(message);
  };
  const view = renderHook(
    (props: { projectId?: string; stream: StreamStatus }) =>
      useFileResources(props.projectId, bus, props.stream, record),
    { initialProps: { projectId, stream } },
  );

  return { ...view, bus, diagnostics };
}

describe("useFileResources", () => {
  it("loads only while a project is open and the shared stream is up", async () => {
    const view = connect(undefined, "connecting");

    expect(pending).toHaveLength(0);
    view.rerender({ projectId: "p1", stream: "connecting" });
    expect(pending).toHaveLength(0);

    view.rerender({ projectId: "p1", stream: "open" });
    expect(pending).toHaveLength(1);
    act(() => pending[0]?.resolve(response({ revision: 1, resources: [], diagnostics: [] })));

    await waitFor(() => expect(view.result.current.snapshot?.revision).toBe(1));
  });

  it("aborts the previous project and ignores its response even if fetch still resolves", async () => {
    const view = connect();
    expect(pending[0]?.projectId).toBe("p1");

    view.rerender({ projectId: "p2", stream: "open" });

    expect(pending[0]?.signal?.aborted).toBe(true);
    expect(pending[1]?.projectId).toBe("p2");
    act(() => pending[1]?.resolve(response({ revision: 4, resources: [], diagnostics: [] })));
    await waitFor(() => expect(view.result.current.snapshot?.revision).toBe(4));

    act(() => pending[0]?.resolve(response({ revision: 8, resources: [], diagnostics: [] })));
    await act(async () => Promise.resolve());
    expect(view.result.current.snapshot?.revision).toBe(4);
  });

  it("refetches the current project on contribution invalidation and stream gaps", async () => {
    const view = connect();
    act(() => pending[0]?.resolve(response({ revision: 8, resources: [], diagnostics: [] })));
    await waitFor(() => expect(view.result.current.snapshot?.revision).toBe(8));

    act(() =>
      view.bus.publish({
        index: 10,
        time: "2026-08-03T00:00:00.000Z",
        type: coreEventTypes.contributionsChanged,
        payload: { revision: 9 },
      }),
    );
    expect(pending).toHaveLength(2);
    expect(view.result.current.stale).toBe(true);

    act(() => pending[1]?.resolve(response({ revision: 9, resources: [], diagnostics: [] })));
    await waitFor(() => expect(view.result.current.snapshot?.revision).toBe(9));

    act(() =>
      view.bus.publish({
        index: 11,
        time: "2026-08-03T00:00:01.000Z",
        type: streamGapType,
        payload: { requestedIndex: 2, oldestIndex: 10 },
      }),
    );
    expect(pending).toHaveLength(3);
  });

  it("aborts its request on unmount", () => {
    const view = connect();
    const signal = pending[0]?.signal;

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
