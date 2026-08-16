import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BrowserRuntimeProvider } from "@sovereign/browser-sdk/host";
import type { BrowserEvent, BrowserEventBridge } from "@sovereign/browser-sdk";
import { MissionPanel } from "./mission-panel.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(events: BrowserEventBridge) {
  return render(
    <BrowserRuntimeProvider
      contributions={[]}
      plugins={[]}
      onDiagnostic={() => {}}
      events={events}
      createCache={() => ({
        load: () => ({ kind: "loading" as const }),
        peek: () => undefined,
        version: () => 0,
        retain: () => {},
        subscribe: () => () => {},
        dispose: () => {},
      })}
    >
      <MissionPanel context={{ subject: { sessionId: "s1" } }} />
    </BrowserRuntimeProvider>,
  );
}

it("renders a mission snapshot and reloads after a matching event", async () => {
  let listener: ((event: BrowserEvent) => void) | undefined;
  const events = {
    subscribe(next: (event: BrowserEvent) => void) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      mission: "Ship it",
      plan: [{ step: "Test", status: "completed" }],
      revision: 1,
      updatedAt: new Date().toISOString(),
    }),
  } as Response);

  renderPanel(events);
  await screen.findByText("Ship it");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(async () =>
    listener?.({
      type: "mission.changed",
      index: 2,
      time: new Date().toISOString(),
      plugin: { key: "builtin:mission", id: "mission", source: "builtin" },
      payload: { sessionId: "s1", revision: 2 },
    }),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
