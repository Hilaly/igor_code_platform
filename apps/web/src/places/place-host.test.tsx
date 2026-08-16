// @vitest-environment jsdom

import type {
  ComponentContributionRegistration,
  PlaceContext,
  PluginStatus,
} from "@sovereign/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { createPluginModuleCache } from "./module-cache.ts";
import { BrowserRuntimeProvider, HostPlace } from "./place-host.tsx";

afterEach(cleanup);

const context: PlaceContext = {};

const plugin = (revision: string): PluginStatus => ({
  key: "data:themed",
  id: "themed",
  source: "data",
  directory: "/plugins/themed",
  state: "running",
  browser: {
    revision,
    entry: `/plugin-assets/themed/${revision}/browser.js`,
    styles: `/plugin-assets/themed/${revision}/styles.css`,
  },
});

const claim = (placeId = "core.settings.plugins"): ComponentContributionRegistration => ({
  ownership: "plugin",
  pluginKey: "data:themed",
  pluginId: "themed",
  source: "data",
  kind: "component",
  id: "themed.board",
  declaredId: "board",
  placeId,
  export: "Panel",
});

it("lets a plugin replace Usage Analytics and falls back to its built-in view", async () => {
  const imported = vi.fn(() => Promise.resolve({ Panel: () => <p>plugin usage</p> }));
  const cache = createPluginModuleCache({ importModule: imported });
  const view = render(
    <BrowserRuntimeProvider
      contributions={[claim("core.settings.usage")]}
      plugins={[plugin("usage-r1")]}
      onDiagnostic={() => {}}
      events={{ subscribe: () => () => {} }}
      cache={cache}
    >
      <HostPlace id="core.settings.usage" context={{}} builtIn={<p>built-in usage</p>} />
    </BrowserRuntimeProvider>,
  );
  const link = stylesheet("usage-r1");

  expect(screen.getByText("built-in usage")).toBeTruthy();
  link.dispatchEvent(new Event("load"));
  await flush();

  expect(screen.getByText("plugin usage")).toBeTruthy();
  view.rerender(
    <BrowserRuntimeProvider
      contributions={[]}
      plugins={[plugin("usage-r1")]}
      onDiagnostic={() => {}}
      events={{ subscribe: () => () => {} }}
      cache={cache}
    >
      <HostPlace id="core.settings.usage" context={{}} builtIn={<p>built-in usage</p>} />
    </BrowserRuntimeProvider>,
  );

  expect(screen.getByText("built-in usage")).toBeTruthy();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const stylesheet = (revision: string): HTMLLinkElement => {
  const link = document.head.querySelector<HTMLLinkElement>(
    `link[data-sovereign-plugin="data:themed@${revision}"]`,
  );
  expect(link).not.toBeNull();
  return link!;
};

it("removes a real plugin stylesheet when the SDK adapter provider unmounts", async () => {
  const imported = vi.fn(() => Promise.resolve({ Panel: () => <p>plugin panel</p> }));
  const cache = createPluginModuleCache({ importModule: imported });
  const view = render(
    <BrowserRuntimeProvider
      contributions={[claim()]}
      plugins={[plugin("r1")]}
      onDiagnostic={() => {}}
      events={{ subscribe: () => () => {} }}
      cache={cache}
    >
      <HostPlace id="core.settings.plugins" context={context} builtIn={<p>built-in</p>} />
    </BrowserRuntimeProvider>,
  );
  const link = stylesheet("r1");

  link.dispatchEvent(new Event("load"));
  await flush();

  expect(screen.getByText("plugin panel")).toBeTruthy();
  view.unmount();
  await flush();

  expect(document.head.querySelector("link[data-sovereign-plugin]")).toBeNull();
  expect(cache.load(plugin("r1"))).toEqual({ kind: "loading" });
});

it("isolates a late callback from an old adapter mount", async () => {
  const oldImport = vi.fn(() => Promise.resolve({ Panel: () => <p>old panel</p> }));
  const oldCache = createPluginModuleCache({ importModule: oldImport });
  const first = render(
    <BrowserRuntimeProvider
      contributions={[claim()]}
      plugins={[plugin("r1")]}
      onDiagnostic={() => {}}
      events={{ subscribe: () => () => {} }}
      cache={oldCache}
    >
      <HostPlace id="core.settings.plugins" context={context} builtIn={<p>built-in</p>} />
    </BrowserRuntimeProvider>,
  );
  const oldLink = stylesheet("r1");

  first.unmount();
  await flush();

  const newImport = vi.fn(() => Promise.resolve({ Panel: () => <p>new panel</p> }));
  const newCache = createPluginModuleCache({ importModule: newImport });
  const second = render(
    <BrowserRuntimeProvider
      contributions={[claim()]}
      plugins={[plugin("r2")]}
      onDiagnostic={() => {}}
      events={{ subscribe: () => () => {} }}
      cache={newCache}
    >
      <HostPlace id="core.settings.plugins" context={context} builtIn={<p>built-in</p>} />
    </BrowserRuntimeProvider>,
  );
  const newLink = stylesheet("r2");

  oldLink.dispatchEvent(new Event("load"));
  await flush();

  expect(newLink.isConnected).toBe(true);
  expect(oldImport).not.toHaveBeenCalled();
  expect(screen.queryByText("new panel")).toBeNull();

  newLink.dispatchEvent(new Event("load"));
  await flush();

  expect(screen.getByText("new panel")).toBeTruthy();
  expect(newLink.isConnected).toBe(true);
  second.unmount();
});
