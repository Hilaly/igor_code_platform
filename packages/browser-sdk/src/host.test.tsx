// @vitest-environment jsdom

import type { ContributionRegistration, PluginStatus } from "@sovereign/protocol";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useContext, type ReactNode } from "react";
import { afterEach, expect, it, vi, type Mock } from "vitest";

import type { BrowserRuntime } from "./runtime-context.tsx";
import { BrowserRuntimeContext } from "./runtime-context.tsx";
import { BrowserRuntimeProvider, type PluginModuleCache, type PluginModuleLoad } from "./host.tsx";

afterEach(cleanup);

const contributions: readonly ContributionRegistration[] = [];
const firstPlugin: PluginStatus = {
  key: "data:first",
  id: "first",
  source: "data",
  directory: "/plugins/first",
  state: "running",
  browser: { revision: "r1", entry: "/assets/first.js" },
};
const secondPlugin: PluginStatus = {
  key: "data:second",
  id: "second",
  source: "data",
  directory: "/plugins/second",
  state: "running",
  browser: { revision: "r1", entry: "/assets/second.js" },
};

type FakeCache = {
  moduleOf: Mock<(status: PluginStatus) => PluginModuleLoad>;
  retain: Mock<(statuses: readonly PluginStatus[]) => void>;
  subscribe: Mock<(listener: () => void) => () => void>;
  dispose: Mock<() => void>;
};

function fakeCache(): FakeCache {
  return {
    moduleOf: vi.fn((status: PluginStatus): PluginModuleLoad => {
      void status;
      return { kind: "loading" };
    }),
    retain: vi.fn(),
    subscribe: vi.fn((listener: () => void) => {
      void listener;
      return () => {};
    }),
    dispose: vi.fn(),
  };
}

function provider(
  children: ReactNode,
  options: {
    plugins?: readonly PluginStatus[];
    cache?: PluginModuleCache;
    createCache?: () => PluginModuleCache;
  } = {},
) {
  return (
    <BrowserRuntimeProvider
      contributions={contributions}
      plugins={options.plugins ?? []}
      onDiagnostic={() => {}}
      createCache={options.createCache ?? fakeCache}
      cache={options.cache}
    >
      {children}
    </BrowserRuntimeProvider>
  );
}

async function flushCacheCleanup(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

it("retains each new plugin snapshot without disposing the current cache", () => {
  const cache = fakeCache();
  const view = render(provider(<p>child</p>, { plugins: [firstPlugin], cache }));

  expect(cache.retain).toHaveBeenCalledTimes(1);
  expect(cache.retain).toHaveBeenLastCalledWith([firstPlugin]);

  view.rerender(provider(<p>child</p>, { plugins: [secondPlugin], cache }));

  expect(cache.retain).toHaveBeenCalledTimes(2);
  expect(cache.retain).toHaveBeenLastCalledWith([secondPlugin]);
  expect(cache.dispose).not.toHaveBeenCalled();
});

it("disposes the owned cache exactly once on unmount", async () => {
  const cache = fakeCache();
  const view = render(provider(<p>child</p>, { cache }));

  view.unmount();
  await flushCacheCleanup();

  expect(cache.dispose).toHaveBeenCalledTimes(1);
});

it("disposes a replaced cache and later disposes the current cache", async () => {
  const oldCache = fakeCache();
  const newCache = fakeCache();
  const view = render(provider(<p>child</p>, { cache: oldCache }));

  view.rerender(provider(<p>child</p>, { cache: newCache }));
  await flushCacheCleanup();

  expect(oldCache.dispose).toHaveBeenCalledTimes(1);
  expect(newCache.dispose).not.toHaveBeenCalled();

  view.unmount();
  await flushCacheCleanup();

  expect(newCache.dispose).toHaveBeenCalledTimes(1);
});

it("keeps the retained cache alive through StrictMode replay", async () => {
  const cache = fakeCache();
  const view = render(<StrictMode>{provider(<p>child</p>, { cache })}</StrictMode>);

  await flushCacheCleanup();
  expect(cache.dispose).not.toHaveBeenCalled();

  view.unmount();
  await flushCacheCleanup();

  expect(cache.dispose).toHaveBeenCalledTimes(1);
});

it("never exposes React's discarded factory cache to child rendering", async () => {
  const caches = [fakeCache(), fakeCache()];
  const createCache = vi.fn(() => {
    const cache = caches[createCache.mock.calls.length - 1];

    if (cache === undefined) {
      throw new Error("React created more caches than expected");
    }

    return cache;
  });
  const observed: BrowserRuntime[] = [];

  function CacheReader() {
    const runtime = useContext(BrowserRuntimeContext);

    if (runtime !== undefined) {
      observed.push(runtime);
      runtime.cache.moduleOf(firstPlugin);
    }

    return null;
  }

  const view = render(
    <StrictMode>{provider(<CacheReader />, { plugins: [firstPlugin], createCache })}</StrictMode>,
  );

  await flushCacheCleanup();

  expect(createCache).toHaveBeenCalledTimes(2);
  expect(observed).toHaveLength(2);
  expect(new Set(observed.map((runtime) => runtime.cache)).size).toBe(1);

  const used = caches.filter((cache) => cache.moduleOf.mock.calls.length > 0);
  const discarded = caches.filter((cache) => cache.moduleOf.mock.calls.length === 0);

  expect(used).toHaveLength(1);
  expect(used[0]?.moduleOf).toHaveBeenCalledTimes(2);
  expect(discarded).toHaveLength(1);
  expect(discarded[0]?.retain).not.toHaveBeenCalled();

  view.unmount();
  await flushCacheCleanup();

  expect(used[0]?.dispose).toHaveBeenCalledTimes(1);
});
