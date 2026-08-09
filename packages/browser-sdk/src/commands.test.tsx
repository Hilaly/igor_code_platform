// @vitest-environment jsdom

import type {
  CommandContributionRegistration,
  ContributionRegistration,
  PluginStatus,
} from "@sovereign/protocol";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserRuntimeProvider,
  HostPlaceCollection,
  type LoadedPluginModule,
  type PluginModuleCache,
  type PluginModuleLoad,
} from "./host.tsx";
import { useCommands, type CommandOutcome } from "./index.tsx";

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

/**
 * Кеш, у которого загрузка завершается по команде теста: вызов команды обязан **дождаться** бандла,
 * и мгновенно готовый модуль этого ожидания не проверяет.
 */
function controllableCache(): {
  cache: PluginModuleCache;
  settle(load: PluginModuleLoad): void;
} {
  const listeners = new Set<() => void>();
  let load: PluginModuleLoad = pending;

  return {
    cache: {
      moduleOf: () => load,
      retain: () => {},
      subscribe: (listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
      dispose: () => {},
    },
    settle(next) {
      load = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function readyCache(module: LoadedPluginModule): PluginModuleCache {
  const load: PluginModuleLoad = { kind: "loaded", module };

  return {
    moduleOf: () => load,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
}

const command = (
  extra: Partial<
    Pick<CommandContributionRegistration, "id" | "title" | "export" | "placeId" | "order">
  > = {},
): CommandContributionRegistration => ({
  ownership: "plugin",
  pluginKey: placed.key,
  pluginId: "placed",
  source: "data",
  kind: "command",
  id: "placed.run",
  declaredId: "run",
  title: "Run the board",
  export: "RunCommand",
  placeId: "core.view.header.actions",
  ...extra,
});

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
      contributions={options.contributions ?? [command()]}
      plugins={options.plugins ?? [placed]}
      onDiagnostic={options.onDiagnostic ?? (() => {})}
      createCache={() => readyCache({})}
      cache={options.cache}
    >
      {children}
    </BrowserRuntimeProvider>
  );
}

/** Кнопка, которая зовёт команду и показывает исход: `invoke` возвращает значение, а не бросает. */
function Caller({
  commandId = "placed.run",
  context = {},
  onOutcome,
}: {
  commandId?: string;
  context?: Parameters<ReturnType<typeof useCommands>["invoke"]>[1];
  onOutcome?: (outcome: CommandOutcome) => void;
}): ReactNode {
  const { invoke } = useCommands();
  const [outcome, setOutcome] = useState<CommandOutcome | undefined>(undefined);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void invoke(commandId, context).then((result) => {
            setOutcome(result);
            onOutcome?.(result);
          });
        }}
      >
        call
      </button>
      <p>{outcome === undefined ? "—" : outcome.kind}</p>
    </>
  );
}

async function call(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "call" }));
  });
}

describe("useCommands", () => {
  it("runs the handler exported by the plugin and reports it done", async () => {
    const ran: unknown[] = [];

    render(
      provider(<Caller context={{ subject: { page: "settings" } }} />, {
        cache: readyCache({ RunCommand: { run: (context: unknown) => ran.push(context) } }),
      }),
    );
    await call();

    expect(ran).toEqual([{ subject: { page: "settings" } }]);
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("waits for the bundle instead of failing on a command called too early", async () => {
    const controllable = controllableCache();
    const ran: unknown[] = [];
    const outcomes: CommandOutcome[] = [];

    render(
      provider(<Caller onOutcome={(outcome) => outcomes.push(outcome)} />, {
        cache: controllable.cache,
      }),
    );
    await call();

    expect(outcomes).toEqual([]);

    await act(async () => {
      controllable.settle({
        kind: "loaded",
        module: { RunCommand: { run: () => ran.push("ran") } },
      });
    });

    expect(ran).toEqual(["ran"]);
    expect(outcomes).toEqual([{ kind: "done" }]);
  });

  /** Обещание, которое некому исполнить, висело бы вечно, и звавший его никогда бы не узнал. */
  it("finishes a call orphaned by the runtime going away", async () => {
    const controllable = controllableCache();
    const outcomes: CommandOutcome[] = [];
    const view = render(
      provider(<Caller onOutcome={(outcome) => outcomes.push(outcome)} />, {
        cache: controllable.cache,
      }),
    );

    await call();
    expect(outcomes).toEqual([]);

    await act(async () => {
      view.unmount();
    });

    expect(outcomes).toEqual([
      { kind: "failed", reason: "the browser runtime went away while the bundle loaded" },
    ]);
  });

  it("does not run a command its handler calls unavailable", async () => {
    const ran: unknown[] = [];

    render(
      provider(<Caller />, {
        cache: readyCache({
          RunCommand: { run: () => ran.push("ran"), available: () => false },
        }),
      }),
    );
    await call();

    expect(ran).toEqual([]);
    expect(screen.getByText("unavailable")).toBeTruthy();
  });

  it("calls a command unknown when nobody declared it", async () => {
    render(provider(<Caller commandId="placed.absent" />, { cache: readyCache({}) }));
    await call();

    expect(screen.getByText("unknown")).toBeTruthy();
  });

  /** Тот же отбор по контексту, что у мест: команда чужого проекта в этом контексте не существует. */
  it("hides a command of another project from the current context", async () => {
    render(
      provider(<Caller context={{ project: "work" }} />, {
        contributions: [
          {
            ...command(),
            ownership: "plugin",
            pluginKey: "project:spare:placed",
            pluginId: "placed",
            source: "project:spare",
          },
        ],
        cache: readyCache({ RunCommand: { run: () => {} } }),
      }),
    );
    await call();

    expect(screen.getByText("unknown")).toBeTruthy();
  });

  it("reports a missing export as a failure and says so in the diagnostics", async () => {
    const diagnostics: string[] = [];

    render(
      provider(<Caller />, {
        cache: readyCache({ SomethingElse: { run: () => {} } }),
        onDiagnostic: (text) => diagnostics.push(text),
      }),
    );
    await call();

    expect(screen.getByText("failed")).toBeTruthy();
    expect(diagnostics).toEqual([
      "the command placed.run failed: the plugin data:placed exports no command RunCommand",
    ]);
  });

  it("reports a bundle that could not be loaded", async () => {
    const controllable = controllableCache();

    render(provider(<Caller />, { cache: controllable.cache }));
    await call();

    await act(async () => {
      controllable.settle({ kind: "failed", reason: "network is down" });
    });

    expect(screen.getByText("failed")).toBeTruthy();
  });

  /** Исключение из обработчика приезжает значением: иначе оно уронило бы дерево звавшего. */
  it("contains an exception thrown by the handler", async () => {
    render(
      provider(<Caller />, {
        cache: readyCache({
          RunCommand: {
            run: () => {
              throw new Error("the board is closed");
            },
          },
        }),
      }),
    );
    await call();

    expect(screen.getByText("failed")).toBeTruthy();
  });
});

describe("the command button in an action place", () => {
  const strip = (options: Parameters<typeof provider>[1] = {}) =>
    render(
      provider(<HostPlaceCollection id="core.view.header.actions" context={{}} />, {
        cache: readyCache({}),
        ...options,
      }),
    );

  /** Метаданные и нужны затем, чтобы полоса не прыгала по мере загрузки плагинов. */
  it("draws itself from the snapshot before any bundle has loaded", () => {
    strip({ cache: controllableCache().cache });

    expect(screen.getByRole("button", { name: "Run the board" })).toBeTruthy();
  });

  it("runs the command when clicked", async () => {
    const ran: unknown[] = [];

    strip({ cache: readyCache({ RunCommand: { run: () => ran.push("ran") } }) });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run the board" }));
    });

    expect(ran).toEqual(["ran"]);
  });

  it("switches itself off once the loaded handler calls itself unavailable", () => {
    strip({
      cache: readyCache({ RunCommand: { run: () => {}, available: () => false } }),
    });

    expect(screen.getByRole("button", { name: "Run the board" })).toHaveProperty("disabled", true);
  });

  it("stands in the same order as the components of the strip", () => {
    strip({
      contributions: [
        command({ id: "placed.zeta", title: "Zeta", order: 2 }),
        {
          ownership: "plugin",
          pluginKey: placed.key,
          pluginId: "placed",
          source: "data",
          kind: "component",
          id: "placed.action",
          declaredId: "action",
          placeId: "core.view.header.actions",
          export: "HeaderAction",
          order: 1,
        },
      ],
      cache: readyCache({
        HeaderAction: () => <button type="button">Action</button>,
        RunCommand: { run: () => {} },
      }),
    });

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Action",
      "Zeta",
    ]);
  });
});

/** Хук отдаёт вызов и тому, кто вызвал его вне места: команду зовут по идентификатору. */
describe("useCommands outside a runtime", () => {
  it("calls everything unknown", async () => {
    const outcomes: CommandOutcome[] = [];

    function Bare(): ReactNode {
      const { invoke } = useCommands();

      useEffect(() => {
        void invoke("placed.run").then((outcome) => outcomes.push(outcome));
      }, [invoke]);

      return null;
    }

    render(<Bare />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(outcomes).toEqual([{ kind: "unknown" }]);
  });
});
