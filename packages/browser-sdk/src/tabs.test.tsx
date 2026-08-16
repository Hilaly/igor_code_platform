// @vitest-environment jsdom

import type {
  ComponentContributionRegistration,
  ContributionRegistration,
  PlaceContributionRegistration,
  PluginStatus,
} from "@sovereign/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserRuntimeProvider,
  type LoadedPluginModule,
  type PluginModuleCache,
  type PluginModuleLoad,
} from "./host.tsx";
import { PlaceTabs } from "./index.tsx";
import { useHostPlaceTabs } from "./tabs.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const placed: PluginStatus = {
  key: "data:placed",
  id: "placed",
  source: "data",
  directory: "/plugins/placed",
  state: "running",
  browser: { revision: "r1", entry: "/assets/placed-r1.js" },
};

const pending: PluginModuleLoad = { kind: "loading" };

/** Ответ обязан быть стабильным по ссылке: `useSyncExternalStore` сравнивает снимки именно ею. */
function cache(modules: Record<string, LoadedPluginModule> = {}): {
  cache: PluginModuleCache;
  asked: string[];
} {
  const asked: string[] = [];
  const loads = new Map<string, PluginModuleLoad>(
    Object.entries(modules).map(([key, module]) => [key, { kind: "loaded", module }]),
  );

  return {
    asked,
    cache: {
      load(status): PluginModuleLoad {
        asked.push(status.key);

        return loads.get(status.key) ?? pending;
      },
      peek: (status) => loads.get(status.key),
      version: () => 0,
      retain: () => {},
      subscribe: () => () => {},
      dispose: () => {},
    },
  };
}

const tab = (
  declaredId: string,
  extra: Partial<
    Pick<ComponentContributionRegistration, "id" | "title" | "placeId" | "export" | "order">
  > = {},
): ComponentContributionRegistration => ({
  ownership: "plugin",
  pluginKey: placed.key,
  pluginId: "placed",
  source: "data",
  kind: "component",
  id: `placed.${declaredId}`,
  declaredId,
  ...(declaredId === "board" ? { title: "Board" } : {}),
  placeId: "core.panel.tabs",
  export: "BoardTab",
  ...extra,
});

const ownTabs: PlaceContributionRegistration = {
  ownership: "plugin",
  pluginKey: placed.key,
  pluginId: "placed",
  source: "data",
  kind: "place",
  id: "placed.workspace",
  declaredId: "workspace",
  title: "Workspace",
  cardinality: "tabs",
  replaceable: false,
};

function provider(
  children: ReactNode,
  options: {
    contributions?: readonly ContributionRegistration[];
    plugins?: readonly PluginStatus[];
    cache?: PluginModuleCache;
    onDiagnostic?: (text: string) => void;
  } = {},
) {
  return (
    <BrowserRuntimeProvider
      contributions={options.contributions ?? []}
      plugins={options.plugins ?? [placed]}
      onDiagnostic={options.onDiagnostic ?? (() => {})}
      events={{ subscribe: () => () => {} }}
      locale="en"
      createCache={() => cache().cache}
      cache={options.cache}
    >
      {children}
    </BrowserRuntimeProvider>
  );
}

/** Полоса хоста: набор данными, а вкладку рисует тот, кто владеет полосой. */
function HostStrip({ id = "core.panel.tabs", open }: { id?: string; open?: string }): ReactNode {
  const tabs = useHostPlaceTabs({ id, context: {} });
  const chosen = tabs.find((entry) => entry.id === open);

  return (
    <>
      <ul>
        {tabs.map((entry) => (
          <li key={entry.id}>{entry.label}</li>
        ))}
      </ul>
      {chosen?.content}
    </>
  );
}

describe("useHostPlaceTabs", () => {
  it("labels every tab from the snapshot, in the order of the contributions", () => {
    render(
      provider(<HostStrip />, {
        contributions: [
          tab("later", { id: "placed.later", title: "Later", order: 2 }),
          tab("board", { order: 1 }),
        ],
      }),
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Board",
      "Later",
    ]);
  });

  /**
   * Заголовка у объявления может не быть: реестр не знает кардинальности места, потому что место
   * вправе ещё не существовать. Подпись обязана остаться детерминированной.
   */
  it("falls back to the declared identifier when the contribution names no title", () => {
    render(provider(<HostStrip />, { contributions: [tab("notes", { id: "placed.notes" })] }));

    expect(screen.getByRole("listitem").textContent).toBe("notes");
  });

  /** Главная механика вкладок: закрытая вкладка существует подписью и бандла не грузит. */
  it("does not touch the module cache until a tab is actually rendered", () => {
    const closed = cache();

    render(provider(<HostStrip />, { contributions: [tab("board")], cache: closed.cache }));

    expect(screen.getByRole("listitem").textContent).toBe("Board");
    expect(closed.asked).toEqual([]);

    cleanup();

    const opened = cache();

    render(
      provider(<HostStrip open="placed.board" />, {
        contributions: [tab("board")],
        cache: opened.cache,
      }),
    );

    expect(opened.asked).toContain(placed.key);
  });

  it("renders the open tab from the bundle of its plugin", () => {
    const loaded = cache({
      [placed.key]: { BoardTab: () => <p>the board</p> },
    });

    render(
      provider(<HostStrip open="placed.board" />, {
        contributions: [tab("board")],
        cache: loaded.cache,
      }),
    );

    expect(screen.getByText("the board")).toBeTruthy();
  });

  /** Место берёт только компоненты: у вкладки обязано быть содержимое, а команда его не даёт. */
  it("leaves commands out of the strip", () => {
    render(
      provider(<HostStrip />, {
        contributions: [
          tab("board"),
          {
            ownership: "plugin",
            pluginKey: placed.key,
            pluginId: "placed",
            source: "data",
            kind: "command",
            id: "placed.run",
            declaredId: "run",
            title: "Run",
            export: "RunCommand",
            placeId: "core.panel.tabs",
          },
        ],
      }),
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Board"]);
  });

  it("gives nothing outside a runtime", () => {
    render(<HostStrip />);

    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });

  /**
   * Упавшая вкладка не роняет полосу: граница экземпляра ловит её, а соседи остаются на месте.
   */
  it("keeps the strip alive when the open tab throws while rendering", () => {
    const diagnostics: string[] = [];
    const loaded = cache({
      [placed.key]: {
        BoardTab: () => {
          throw new Error("no board today");
        },
      },
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      provider(<HostStrip open="placed.board" />, {
        contributions: [tab("board")],
        cache: loaded.cache,
        onDiagnostic: (text) => diagnostics.push(text),
      }),
    );

    expect(screen.getByRole("listitem").textContent).toBe("Board");
    expect(diagnostics.some((text) => text.includes("placed.board"))).toBe(true);
  });
});

describe("PlaceTabs", () => {
  function Own({ id = "placed.workspace" }: { id?: string }): ReactNode {
    return <PlaceTabs id={id} context={{}} />;
  }

  it("renders the strip of a place its owner declared as tabs", () => {
    const loaded = cache({
      [placed.key]: { BoardTab: () => <p>the board</p> },
    });

    render(
      provider(<Own />, {
        contributions: [ownTabs, tab("board", { placeId: "placed.workspace" })],
        cache: loaded.cache,
      }),
    );

    expect(screen.getByRole("tab").textContent).toBe("Board");
    expect(screen.getByText("the board")).toBeTruthy();
  });

  /** Та же проверка кардинальности, что у `Place` и `PlaceCollection`: чужая форма — пусто. */
  it("draws nothing on a place of another cardinality", () => {
    render(
      provider(<Own />, {
        contributions: [
          { ...ownTabs, cardinality: "collection" },
          tab("board", { placeId: "placed.workspace" }),
        ],
      }),
    );

    expect(screen.queryByRole("tab")).toBe(null);
  });

  it("draws nothing when nobody claimed the place", () => {
    render(provider(<Own />, { contributions: [ownTabs] }));

    expect(screen.queryByRole("tab")).toBe(null);
  });
});

/** Полоса плагина помнит выбор, пока смонтирована, и забывает его после размонтирования. */
describe("PlaceTabs and the open tab", () => {
  it("keeps its choice across re-renders", () => {
    const loaded = cache({
      [placed.key]: {
        BoardTab: () => <p>the board</p>,
        NotesTab: () => <p>the notes</p>,
      },
    });

    function Host(): ReactNode {
      const [, redraw] = useState(0);

      return (
        <>
          <button type="button" onClick={() => redraw((count) => count + 1)}>
            redraw
          </button>
          <PlaceTabs id="placed.workspace" context={{}} />
        </>
      );
    }

    render(
      provider(<Host />, {
        contributions: [
          ownTabs,
          tab("board", { placeId: "placed.workspace", order: 1 }),
          tab("notes", {
            id: "placed.notes",
            title: "Notes",
            placeId: "placed.workspace",
            export: "NotesTab",
            order: 2,
          }),
        ],
        cache: loaded.cache,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByText("the notes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "redraw" }));
    expect(screen.getByText("the notes")).toBeTruthy();
  });
});
