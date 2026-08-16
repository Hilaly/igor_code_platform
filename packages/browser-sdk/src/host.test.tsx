// @vitest-environment jsdom

import type {
  ComponentContributionRegistration,
  ContributionRegistration,
  PlaceContributionRegistration,
  PluginSource,
  PluginStatus,
} from "@sovereign/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, useContext, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { Place, PlaceCollection, type PlaceContext } from "./index.tsx";
import { boundaryKey } from "./instance-boundary.tsx";
import type { BrowserRuntime } from "./runtime-context.tsx";
import { BrowserRuntimeContext } from "./runtime-context.tsx";
import {
  BrowserRuntimeProvider,
  HostPlace,
  HostPlaceCollection,
  PlaceInstance,
  type BrowserExportReference,
  type LoadedPluginModule,
  type PluginModuleCache,
  type PluginModuleLoad,
} from "./host.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pending: PluginModuleLoad = { kind: "loading" };

type FakeCache = PluginModuleCache & {
  load: Mock<PluginModuleCache["load"]>;
  peek: Mock<PluginModuleCache["peek"]>;
  version: Mock<PluginModuleCache["version"]>;
  retain: Mock<PluginModuleCache["retain"]>;
  subscribe: Mock<PluginModuleCache["subscribe"]>;
  dispose: Mock<PluginModuleCache["dispose"]>;
};

function fakeCache(initial: Record<string, PluginModuleLoad> = {}): {
  cache: FakeCache;
  set(status: PluginStatus, load: PluginModuleLoad): void;
} {
  const loads = new Map(Object.entries(initial));
  const listeners = new Set<() => void>();
  const keyOf = (status: PluginStatus) => `${status.key}@${status.browser?.revision ?? ""}`;
  const known = (status: PluginStatus) => loads.get(keyOf(status));
  let version = 0;
  const cache: FakeCache = {
    load: vi.fn((status) => known(status) ?? pending),
    peek: vi.fn(known),
    version: vi.fn(() => version),
    retain: vi.fn(),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    dispose: vi.fn(),
  };

  return {
    cache,
    set(status, load) {
      loads.set(keyOf(status), load);
      version += 1;
      for (const listener of [...listeners]) listener();
    },
  };
}

const loaded = (module: LoadedPluginModule): PluginModuleLoad => ({ kind: "loaded", module });

const status = (pluginId: string, source: PluginSource, revision = "r1"): PluginStatus => ({
  key: `${source}:${pluginId}`,
  id: pluginId,
  source,
  directory: `/plugins/${pluginId}`,
  state: "running",
  browser: { revision, entry: `/assets/${pluginId}-${revision}.js` },
});

const component = (
  pluginId: string,
  source: PluginSource,
  placeId: string,
  extra: Partial<
    Pick<
      ComponentContributionRegistration,
      "id" | "declaredId" | "placeId" | "export" | "group" | "order"
    >
  > = {},
): ComponentContributionRegistration => ({
  ownership: "plugin",
  pluginKey: `${source}:${pluginId}`,
  pluginId,
  source,
  kind: "component",
  id: `${pluginId}.panel`,
  declaredId: "panel",
  placeId,
  export: "Panel",
  ...extra,
});

const board = (
  extra: Partial<
    Pick<
      PlaceContributionRegistration,
      "id" | "declaredId" | "cardinality" | "replaceable" | "builtIn"
    >
  > = {},
): PlaceContributionRegistration => ({
  ownership: "plugin",
  pluginKey: "data:placed",
  pluginId: "placed",
  source: "data",
  kind: "place",
  id: "placed.board",
  declaredId: "board",
  cardinality: "single",
  replaceable: true,
  builtIn: "Board",
  ...extra,
});

const createEmptyCache = (): PluginModuleCache => fakeCache().cache;

function provider(
  children: ReactNode,
  options: {
    contributions?: readonly ContributionRegistration[];
    plugins?: readonly PluginStatus[];
    onDiagnostic?: (text: string) => void;
    cache?: PluginModuleCache;
    createCache?: () => PluginModuleCache;
  } = {},
) {
  return (
    <BrowserRuntimeProvider
      contributions={options.contributions ?? []}
      plugins={options.plugins ?? []}
      onDiagnostic={options.onDiagnostic ?? (() => {})}
      events={{ subscribe: () => () => {} }}
      createCache={options.createCache ?? createEmptyCache}
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

describe("BrowserRuntimeProvider lifecycle", () => {
  const firstPlugin = status("first", "data");
  const secondPlugin = status("second", "data");

  it("retains each new plugin snapshot without disposing the current cache", () => {
    const { cache } = fakeCache();
    const view = render(provider(<p>child</p>, { plugins: [firstPlugin], cache }));

    expect(cache.retain).toHaveBeenCalledTimes(1);
    expect(cache.retain).toHaveBeenLastCalledWith([firstPlugin]);

    view.rerender(provider(<p>child</p>, { plugins: [secondPlugin], cache }));

    expect(cache.retain).toHaveBeenCalledTimes(2);
    expect(cache.retain).toHaveBeenLastCalledWith([secondPlugin]);
    expect(cache.dispose).not.toHaveBeenCalled();
  });

  it("disposes the owned cache exactly once on unmount", async () => {
    const { cache } = fakeCache();
    const view = render(provider(<p>child</p>, { cache }));

    view.unmount();
    await flushCacheCleanup();

    expect(cache.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a replaced cache and later disposes the current cache", async () => {
    const oldCache = fakeCache().cache;
    const newCache = fakeCache().cache;
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
    const { cache } = fakeCache();
    const view = render(<StrictMode>{provider(<p>child</p>, { cache })}</StrictMode>);

    await flushCacheCleanup();
    expect(cache.dispose).not.toHaveBeenCalled();

    view.unmount();
    await flushCacheCleanup();

    expect(cache.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes caches once when StrictMode replay is immediately followed by replacement", async () => {
    const oldCache = fakeCache().cache;
    const newCache = fakeCache().cache;
    const view = render(<StrictMode>{provider(<p>child</p>, { cache: oldCache })}</StrictMode>);

    view.rerender(<StrictMode>{provider(<p>child</p>, { cache: newCache })}</StrictMode>);
    await flushCacheCleanup();

    expect(oldCache.dispose).toHaveBeenCalledTimes(1);
    expect(newCache.dispose).not.toHaveBeenCalled();

    view.unmount();
    await flushCacheCleanup();

    expect(oldCache.dispose).toHaveBeenCalledTimes(1);
    expect(newCache.dispose).toHaveBeenCalledTimes(1);
  });

  it("never exposes React's discarded factory cache to child rendering", async () => {
    const caches = [fakeCache().cache, fakeCache().cache];
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
        runtime.cache.load(firstPlugin);
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

    const used = caches.filter((cache) => cache.load.mock.calls.length > 0);
    const discarded = caches.filter((cache) => cache.load.mock.calls.length === 0);

    expect(used).toHaveLength(1);
    expect(used[0]?.load).toHaveBeenCalledTimes(2);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.retain).not.toHaveBeenCalled();

    view.unmount();
    await flushCacheCleanup();

    expect(used[0]?.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("core places", () => {
  const placeId = "core.settings.plugins";
  const context: PlaceContext = {};
  const builtIn = <p>built-in</p>;

  it("keeps the built-in provider when nobody claims the place", () => {
    render(provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />));

    expect(screen.getByText("built-in")).toBeTruthy();
  });

  it("puts the component of the plugin in place of the built-in provider", () => {
    const themed = status("themed", "data");
    const { cache } = fakeCache({
      "data:themed@r1": loaded({ Panel: () => <p>from the plugin</p> }),
    });

    render(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions: [component("themed", "data", placeId)],
        plugins: [themed],
        cache,
      }),
    );

    expect(screen.getByText("from the plugin")).toBeTruthy();
    expect(screen.queryByText("built-in")).toBeNull();
  });

  it("leaves a window-wide place built in when only a project plugin claims it", () => {
    const themed = status("themed", "project:work");
    const { cache } = fakeCache({
      "project:work:themed@r1": loaded({ Panel: () => <p>from the plugin</p> }),
    });

    render(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions: [component("themed", "project:work", placeId)],
        plugins: [themed],
        cache,
      }),
    );

    expect(screen.getByText("built-in")).toBeTruthy();
    expect(cache.load).not.toHaveBeenCalled();
  });

  it("applies neither claimant of equal rank and says so once", () => {
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache();
    const contributions = [
      component("second", "data", placeId),
      component("first", "data", placeId),
    ];
    const view = render(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions,
        plugins: [status("first", "data"), status("second", "data")],
        onDiagnostic,
        cache,
      }),
    );

    view.rerender(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions,
        plugins: [status("first", "data"), status("second", "data")],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("built-in")).toBeTruthy();
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic.mock.calls[0]?.[0]).toContain("first.panel, second.panel");
    expect(cache.load).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing export",
      load: loaded({ Board: () => null }),
      complaint: "exports no Panel",
    },
    {
      name: "failed load",
      load: { kind: "failed", reason: "404 bundle" } as const,
      complaint: "could not be loaded",
    },
  ])("falls back after a $name", ({ load, complaint }) => {
    const themed = status("themed", "data");
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache({ "data:themed@r1": load });

    render(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions: [component("themed", "data", placeId)],
        plugins: [themed],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("built-in")).toBeTruthy();
    expect(onDiagnostic.mock.calls[0]?.[0]).toContain(complaint);
  });

  it("sits a rebuild out with the built-in provider and says nothing", () => {
    const rebuilding: PluginStatus = {
      ...status("themed", "data"),
      state: "building",
      browser: undefined,
    };
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache();

    render(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions: [component("themed", "data", placeId)],
        plugins: [rebuilding],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("built-in")).toBeTruthy();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  it("keeps the shell alive when the component throws while rendering", () => {
    const themed = status("themed", "data");
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache({
      "data:themed@r1": loaded({
        Panel: () => {
          throw new Error("no idea what I am doing");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions: [component("themed", "data", placeId)],
        plugins: [themed],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("built-in")).toBeTruthy();
    expect(onDiagnostic.mock.calls[0]?.[0]).toContain("failed while rendering");
  });

  it("gives the place to the more specific source", () => {
    const plain = status("plain", "builtin");
    const special = status("special", "data");
    const { cache } = fakeCache({
      "builtin:plain@r1": loaded({ Panel: () => <p>plain</p> }),
      "data:special@r1": loaded({ Panel: () => <p>special</p> }),
    });

    render(
      provider(<HostPlace id={placeId} context={context} builtIn={builtIn} />, {
        contributions: [
          component("plain", "builtin", placeId),
          component("special", "data", placeId),
        ],
        plugins: [plain, special],
        cache,
      }),
    );

    expect(screen.getByText("special")).toBeTruthy();
  });

  it("orders a collection and isolates a failing instance", () => {
    const collectionId = "core.sidebar.sections";
    const plugins = [status("late", "data"), status("early", "data"), status("broken", "data")];
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache({
      "data:late@r1": loaded({ Panel: () => <p>late</p> }),
      "data:early@r1": loaded({ Panel: () => <p>early</p> }),
      "data:broken@r1": loaded({
        Panel: () => {
          throw new Error("nope");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      provider(<HostPlaceCollection id={collectionId} context={context} />, {
        contributions: [
          component("late", "data", collectionId, { order: 2 }),
          component("early", "data", collectionId, { order: 1 }),
          component("broken", "data", collectionId, { order: 3 }),
        ],
        plugins,
        onDiagnostic,
        cache,
      }),
    );

    expect([...document.body.querySelectorAll("p")].map((node) => node.textContent)).toEqual([
      "early",
      "late",
    ]);
    expect(onDiagnostic.mock.calls[0]?.[0]).toContain("broken.panel");
  });
});

describe("plugin-owned single places", () => {
  const placed = status("placed", "data");
  const context: PlaceContext = { project: "work" };

  it("renders the owner's builtIn export", () => {
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache({
      "data:placed@r1": loaded({
        Board: ({ context: received }: { context: PlaceContext }) => (
          <p>owner:{received.project}</p>
        ),
      }),
    });

    render(
      provider(<Place id="placed.board" context={context} />, {
        contributions: [board()],
        plugins: [placed],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("owner:work")).toBeTruthy();
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(cache.load).toHaveBeenCalledWith(placed);
  });

  it("replaces the owner and passes the same context", () => {
    const rival = status("rival", "data");
    const { cache } = fakeCache({
      "data:placed@r1": loaded({ Board: () => <p>owner</p> }),
      "data:rival@r1": loaded({
        Replacement: ({ context: received }: { context: PlaceContext }) => (
          <p>rival:{received.project}</p>
        ),
      }),
    });

    render(
      provider(<Place id="placed.board" context={context} />, {
        contributions: [
          board(),
          component("rival", "data", "placed.board", {
            id: "rival.board",
            export: "Replacement",
          }),
        ],
        plugins: [placed, rival],
        cache,
      }),
    );

    expect(screen.getByText("rival:work")).toBeTruthy();
    expect(screen.queryByText("owner")).toBeNull();
  });

  it("keeps the owner after an equal-rank dispute and reports it once", () => {
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache({
      "data:placed@r1": loaded({ Board: () => <p>owner</p> }),
    });
    const contributions = [
      board(),
      component("second", "data", "placed.board", { id: "second.board" }),
      component("first", "data", "placed.board", { id: "first.board" }),
    ];
    const view = render(
      provider(<Place id="placed.board" context={context} />, {
        contributions,
        plugins: [placed, status("first", "data"), status("second", "data")],
        onDiagnostic,
        cache,
      }),
    );

    view.rerender(
      provider(<Place id="placed.board" context={context} />, {
        contributions,
        plugins: [placed, status("first", "data"), status("second", "data")],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("owner")).toBeTruthy();
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic.mock.calls[0]?.[0]).toContain("first.board, second.board");
    expect(cache.load.mock.calls.every(([plugin]) => plugin === placed)).toBe(true);
  });

  it.each([
    {
      name: "load failure",
      replacement: { kind: "failed", reason: "404 rival" } as const,
      complaint: "could not be loaded",
    },
    {
      name: "missing export",
      replacement: loaded({ Wrong: () => null }),
      complaint: "exports no Replacement",
    },
    {
      name: "render failure",
      replacement: loaded({
        Replacement: () => {
          throw new Error("broken rival");
        },
      }),
      complaint: "failed while rendering",
    },
  ])("falls back to the owner after replacement $name", ({ replacement, complaint }) => {
    const rival = status("rival", "data");
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache({
      "data:placed@r1": loaded({ Board: () => <p>owner</p> }),
      "data:rival@r1": replacement,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      provider(<Place id="placed.board" context={context} />, {
        contributions: [
          board(),
          component("rival", "data", "placed.board", {
            id: "rival.board",
            export: "Replacement",
          }),
        ],
        plugins: [placed, rival],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("owner")).toBeTruthy();
    expect(onDiagnostic.mock.calls[0]?.[0]).toContain(complaint);
  });

  it("renders nothing for an absent declaration without loading a waiting claim", () => {
    const { cache } = fakeCache();
    const onDiagnostic = vi.fn();

    render(
      provider(<Place id="placed.board" context={context} />, {
        contributions: [component("rival", "data", "placed.board")],
        plugins: [status("rival", "data")],
        onDiagnostic,
        cache,
      }),
    );

    expect(document.body.textContent).toBe("");
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(cache.load).not.toHaveBeenCalled();
  });

  it.each(["Board", undefined])(
    "ignores claims for a non-replaceable place with builtIn %s",
    (builtIn) => {
      const { cache } = fakeCache({
        "data:placed@r1": loaded({ Board: () => <p>owner</p> }),
      });

      render(
        provider(<Place id="placed.board" context={context} />, {
          contributions: [
            board({ replaceable: false, ...(builtIn === undefined ? { builtIn } : {}) }),
            component("rival", "data", "placed.board"),
          ],
          plugins: [placed, status("rival", "data")],
          cache,
        }),
      );

      if (builtIn === undefined) {
        expect(document.body.textContent).toBe("");
        expect(cache.load).not.toHaveBeenCalled();
      } else {
        expect(screen.getByText("owner")).toBeTruthy();
        expect(cache.load).toHaveBeenCalledWith(placed);
      }
    },
  );

  it.each(["collection", "action"] as const)(
    "does not render a %s declaration through Place",
    (cardinality) => {
      const { cache } = fakeCache();

      render(
        provider(<Place id="placed.board" context={context} />, {
          contributions: [board({ cardinality, replaceable: false })],
          plugins: [placed],
          cache,
        }),
      );

      expect(document.body.textContent).toBe("");
      expect(cache.load).not.toHaveBeenCalled();
    },
  );
});

describe.each(["collection", "action"] as const)("plugin-owned %s places", (cardinality) => {
  const placeId = `placed.${cardinality}`;
  const declaration = board({
    id: placeId,
    declaredId: cardinality,
    cardinality,
    replaceable: false,
    builtIn: undefined,
  });
  const plugins = ["zero", "alpha", "broken", "omega", "groupb"].map((id) => status(id, "data"));

  it("orders by group, order and id while isolating a broken item", () => {
    const onDiagnostic = vi.fn();
    const { cache } = fakeCache({
      "data:zero@r1": loaded({ Item: () => <span data-item="zero.item">zero</span> }),
      "data:alpha@r1": loaded({ Item: () => <span data-item="alpha.item">alpha</span> }),
      "data:omega@r1": loaded({ Item: () => <span data-item="omega.item">omega</span> }),
      "data:groupb@r1": loaded({ Item: () => <span data-item="groupb.item">group b</span> }),
      "data:broken@r1": loaded({
        Item: () => {
          throw new Error("broken item");
        },
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      provider(<PlaceCollection id={placeId} context={{}} />, {
        contributions: [
          declaration,
          component("groupb", "data", placeId, {
            id: "groupb.item",
            export: "Item",
            group: "b",
            order: -100,
          }),
          component("broken", "data", placeId, {
            id: "middle.item",
            export: "Item",
            group: "a",
            order: 1,
          }),
          component("zero", "data", placeId, {
            id: "zero.item",
            export: "Item",
            group: "a",
            order: 0,
          }),
          component("alpha", "data", placeId, {
            id: "alpha.item",
            export: "Item",
            group: "a",
            order: 1,
          }),
          component("omega", "data", placeId, {
            id: "omega.item",
            export: "Item",
            group: "a",
            order: 1,
          }),
        ],
        plugins,
        onDiagnostic,
        cache,
      }),
    );

    expect(
      [...document.body.querySelectorAll<HTMLElement>("[data-item]")].map(
        (node) => node.dataset.item,
      ),
    ).toEqual(["zero.item", "alpha.item", "omega.item", "groupb.item"]);
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic.mock.calls[0]?.[0]).toContain("middle.item");
  });

  it("renders nothing without a declaration", () => {
    const { cache } = fakeCache();

    render(
      provider(<PlaceCollection id={placeId} context={{}} />, {
        contributions: [component("alpha", "data", placeId)],
        plugins,
        cache,
      }),
    );

    expect(document.body.textContent).toBe("");
    expect(cache.load).not.toHaveBeenCalled();
  });

  it(`renders an assigned command only when the place is action`, () => {
    const alpha = status("alpha", "data");
    const { cache } = fakeCache();

    render(
      provider(<PlaceCollection id={placeId} context={{}} />, {
        contributions: [
          declaration,
          {
            ownership: "plugin",
            pluginKey: alpha.key,
            pluginId: "alpha",
            source: "data",
            kind: "command",
            id: "alpha.run",
            declaredId: "run",
            title: "Run alpha",
            export: "RunCommand",
            placeId,
          },
        ],
        plugins: [alpha],
        cache,
      }),
    );

    const button = screen.queryByRole("button", { name: "Run alpha" });

    if (cardinality === "action") {
      expect(button).toBeTruthy();
    } else {
      expect(button).toBeNull();
    }
  });
});

it("uses distinct React keys for a component and command with the same id", () => {
  const alpha = status("alpha", "data");
  const action = board({
    id: "placed.action",
    declaredId: "action",
    cardinality: "action",
    replaceable: false,
    builtIn: undefined,
  });
  const { cache } = fakeCache({
    "data:alpha@r1": loaded({
      Item: () => <button type="button">Component alpha</button>,
      RunCommand: { run: () => {} },
    }),
  });
  const onError = vi.spyOn(console, "error").mockImplementation(() => {});

  render(
    provider(<PlaceCollection id={action.id} context={{}} />, {
      contributions: [
        action,
        component("alpha", "data", action.id, {
          id: "alpha.shared",
          export: "Item",
        }),
        {
          ownership: "plugin",
          pluginKey: alpha.key,
          pluginId: "alpha",
          source: "data",
          kind: "command",
          id: "alpha.shared",
          declaredId: "shared",
          title: "Command alpha",
          export: "RunCommand",
          placeId: action.id,
        },
      ],
      plugins: [alpha],
      cache,
    }),
  );

  expect(screen.getByRole("button", { name: "Component alpha" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Command alpha" })).toBeTruthy();
  expect(
    onError.mock.calls.some(([message]) =>
      String(message).includes("Encountered two children with the same key"),
    ),
  ).toBe(false);
});

it("does not render a single declaration through PlaceCollection", () => {
  const { cache } = fakeCache();

  render(
    provider(<PlaceCollection id="placed.board" context={{}} />, {
      contributions: [board(), component("rival", "data", "placed.board")],
      plugins: [status("placed", "data"), status("rival", "data")],
      cache,
    }),
  );

  expect(document.body.textContent).toBe("");
  expect(cache.load).not.toHaveBeenCalled();
});

describe("instance boundary identity", () => {
  it("changes for every browser export reference field", () => {
    const base = boundaryKey("data:placed", "placed.panel", "Panel", "r1");

    expect(base).not.toBe(boundaryKey("data:rival", "placed.panel", "Panel", "r1"));
    expect(base).not.toBe(boundaryKey("data:placed", "placed.other", "Panel", "r1"));
    expect(base).not.toBe(boundaryKey("data:placed", "placed.panel", "Other", "r1"));
    expect(base).not.toBe(boundaryKey("data:placed", "placed.panel", "Panel", "r2"));
    expect(boundaryKey("data:placed", "placed.panel", "Panel", undefined)).not.toBe(base);
  });

  it("makes a real new render attempt when the export changes at the same revision", () => {
    const placed = status("placed", "data");
    const { cache } = fakeCache({
      "data:placed@r1": loaded({
        Panel: () => {
          throw new Error("broken Panel");
        },
        Other: () => <p>repaired Other</p>,
      }),
    });
    const onDiagnostic = vi.fn();
    const panel: BrowserExportReference = {
      pluginKey: "data:placed",
      contributionId: "placed.panel",
      exportName: "Panel",
    };
    const other: BrowserExportReference = { ...panel, exportName: "Other" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(
      provider(<PlaceInstance reference={panel} context={{}} fallback={<p>fallback</p>} />, {
        plugins: [placed],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("fallback")).toBeTruthy();

    view.rerender(
      provider(<PlaceInstance reference={other} context={{}} fallback={<p>fallback</p>} />, {
        plugins: [placed],
        onDiagnostic,
        cache,
      }),
    );

    expect(screen.getByText("repaired Other")).toBeTruthy();
    expect(screen.queryByText("fallback")).toBeNull();
  });
});
