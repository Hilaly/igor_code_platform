import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BrowserRuntimeProvider } from "@sovereign/browser-sdk/host";
import type {
  BrowserEvent,
  BrowserEventBridge,
  BrowserEventListener,
  BrowserRecoveryListener,
} from "@sovereign/browser-sdk";
import { MissionPanel } from "./mission-panel.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function event(type: string, payload: unknown = {}): BrowserEvent {
  return {
    type,
    index: 2,
    time: "2026-08-16T12:30:00.000Z",
    payload,
  } as BrowserEvent;
}

function snapshot(mission: string, revision: number, updatedAt = "2026-08-16T12:30:00.000Z") {
  return {
    mission,
    plan: [{ step: "Test", status: "completed" as const }],
    revision,
    updatedAt,
  };
}

function response(value: ReturnType<typeof snapshot>): Response {
  return { ok: true, status: 200, json: async () => value } as Response;
}

function bridge() {
  const eventListeners = new Set<BrowserEventListener>();
  const recoveryListeners = new Set<BrowserRecoveryListener>();
  const events: BrowserEventBridge = {
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeRecovery(listener) {
      recoveryListeners.add(listener);
      return () => recoveryListeners.delete(listener);
    },
  };
  return {
    events,
    publish(next: BrowserEvent) {
      for (const listener of eventListeners) listener(next);
    },
    recover() {
      for (const listener of recoveryListeners) listener();
    },
    listenerCounts: () => [eventListeners.size, recoveryListeners.size],
  };
}

function renderPanel(events: BrowserEventBridge, sessionId = "s1") {
  const cache = {
    load: () => ({ kind: "loading" as const }),
    peek: () => undefined,
    version: () => 0,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
  const view = render(
    <BrowserRuntimeProvider
      contributions={[]}
      plugins={[]}
      onDiagnostic={() => {}}
      events={events}
      cache={cache}
      createCache={() => cache}
    >
      <MissionPanel context={{ subject: { sessionId } }} />
    </BrowserRuntimeProvider>,
  );
  return {
    ...view,
    rerenderSession(nextSessionId: string) {
      view.rerender(
        <BrowserRuntimeProvider
          contributions={[]}
          plugins={[]}
          onDiagnostic={() => {}}
          events={events}
          cache={cache}
          createCache={() => cache}
        >
          <MissionPanel context={{ subject: { sessionId: nextSessionId } }} />
        </BrowserRuntimeProvider>,
      );
    },
  };
}

it("reloads for matching mission events, stream gaps, and stream recovery", async () => {
  const channel = bridge();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(snapshot("Ship", 3)));
  renderPanel(channel.events);
  await screen.findByText("Ship");

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "other", revision: 4 })),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "s1", revision: 4 })),
  );
  await act(async () => channel.publish(event("core.stream.gap")));
  await act(async () => channel.recover());

  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("keeps the revision announced by an event as the required response floor", async () => {
  const channel = bridge();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response(snapshot("Revision one", 1)))
    .mockResolvedValueOnce(response(snapshot("Still revision one", 1)))
    .mockResolvedValueOnce(response(snapshot("Revision two", 2)));
  renderPanel(channel.events);
  await screen.findByText("Revision one");

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "s1", revision: 2 })),
  );
  expect(screen.queryByText("Still revision one")).toBeNull();
  expect(screen.getByText("Revision one")).not.toBeNull();

  await act(async () => channel.recover());
  await screen.findByText("Revision two");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("clears the old session immediately and ignores its late response", async () => {
  const channel = bridge();
  let resolveSecond: ((value: Response) => void) | undefined;
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response(snapshot("Session one", 1)))
    .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
  const view = renderPanel(channel.events);
  await screen.findByText("Session one");

  view.rerenderSession("s2");
  expect(screen.queryByText("Session one")).toBeNull();
  expect(screen.getByText("Loading mission")).not.toBeNull();

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "s1", revision: 9 })),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => resolveSecond?.(response(snapshot("Session two", 1))));
  await screen.findByText("Session two");
});

it("shows updated time and unsubscribes from events and recovery", async () => {
  const channel = bridge();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response(snapshot("Ship", 1)));
  const view = renderPanel(channel.events);

  await screen.findByText("Ship");
  expect(screen.getByText(/Updated.*2026/u)).not.toBeNull();
  expect(channel.listenerCounts()).toEqual([1, 1]);

  view.unmount();
  await waitFor(() => expect(channel.listenerCounts()).toEqual([0, 0]));
});
