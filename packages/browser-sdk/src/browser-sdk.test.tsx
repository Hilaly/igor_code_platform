// @vitest-environment jsdom

import type { PlaceContext as ProtocolPlaceContext } from "@sovereign/protocol";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useEffect } from "react";

import * as browserSdk from "./index.tsx";
import { BrowserRuntimeProvider } from "./host.tsx";
import {
  Place,
  PlaceCollection,
  PlaceTabs,
  settingsSections,
  type CoreDestination,
  type PlaceContext,
  type SettingsSection,
} from "./index.tsx";
import type { BrowserEvent } from "./runtime-context.tsx";

afterEach(cleanup);

it("exports only the public browser SDK surface at runtime", () => {
  expect(Object.keys(browserSdk).sort()).toEqual([
    "Place",
    "PlaceCollection",
    "PlaceTabs",
    "settingsSections",
    "useCommandCatalog",
    "useCommands",
    "usePageNavigation",
    "useSovereignEvents",
    "useTranslator",
  ]);
});

it("exports a host event bridge hook that subscribes and cleans up", () => {
  const listeners = new Set<(event: BrowserEvent) => void>();
  const recoveryListeners = new Set<() => void>();
  const events = {
    subscribe(listener: (event: BrowserEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeRecovery(listener: () => void) {
      recoveryListeners.add(listener);
      return () => recoveryListeners.delete(listener);
    },
  };
  const seen: string[] = [];
  function Probe() {
    const bridge = browserSdk.useSovereignEvents();
    useEffect(() => {
      const unsubscribeEvent = bridge.subscribe((event) => seen.push(event.type));
      const unsubscribeRecovery = bridge.subscribeRecovery?.(() => seen.push("recovery"));
      return () => {
        unsubscribeEvent();
        unsubscribeRecovery?.();
      };
    }, [bridge]);
    return null;
  }
  const view = render(
    <BrowserRuntimeProvider
      contributions={[]}
      plugins={[]}
      onDiagnostic={() => {}}
      events={events}
      locale="en"
      createCache={createCache}
    >
      <Probe />
    </BrowserRuntimeProvider>,
  );

  act(() => {
    for (const listener of listeners) listener({ type: "core.stream.gap" } as BrowserEvent);
    for (const listener of recoveryListeners) listener();
  });
  expect(seen).toEqual(["core.stream.gap", "recovery"]);

  view.unmount();
  expect(listeners.size).toBe(0);
  expect(recoveryListeners.size).toBe(0);
});

function createCache() {
  return {
    load: () => ({ kind: "loading" as const }),
    peek: () => undefined,
    version: () => 0,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
}

it("exports every public navigation destination from the browser SDK root", () => {
  const sections: SettingsSection[] = [
    "projects",
    "appearance",
    "usage",
    "providers",
    "aliases",
    "plugins",
    "daemon",
    "diagnostics",
  ];
  const destinations: CoreDestination[] = [
    { kind: "home" },
    { kind: "session", sessionId: "01JD8Z" },
    { kind: "new-session" },
    { kind: "session-archive" },
    { kind: "settings", section: "plugins" },
    { kind: "plugin-page", pluginId: "placed", pageId: "log" },
    {
      kind: "plugin-page",
      pluginId: "placed",
      pageId: "log",
      path: "/entry/3",
      query: { filter: "warn" },
    },
  ];

  expect(settingsSections).toEqual(sections);
  expect(destinations.map((destination) => destination.kind)).toEqual([
    "home",
    "session",
    "new-session",
    "session-archive",
    "settings",
    "plugin-page",
    "plugin-page",
  ]);
});

it("keeps its public place context structurally compatible with the protocol", () => {
  const sdkContext: PlaceContext = { project: "work", subject: { sessionId: "s1" } };
  const protocolContext: ProtocolPlaceContext = sdkContext;
  const roundTrip: PlaceContext = protocolContext;

  expect(roundTrip).toEqual(sdkContext);
});

it("renders an empty result when Place has no browser runtime", () => {
  const view = render(<Place id="placed.board" context={{}} />);

  expect(view.container.firstChild).toBeNull();
});

it("renders an empty result when PlaceCollection has no browser runtime", () => {
  const view = render(<PlaceCollection id="placed.actions" context={{}} />);

  expect(view.container.firstChild).toBeNull();
});

it("renders an empty result when PlaceTabs has no browser runtime", () => {
  const view = render(<PlaceTabs id="placed.workspace" context={{}} />);

  expect(view.container.firstChild).toBeNull();
});
