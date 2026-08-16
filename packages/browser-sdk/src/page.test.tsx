// @vitest-environment jsdom

import type { PluginOwnedPageRegistration, PluginStatus } from "@sovereign/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserRuntimeProvider,
  type LoadedPluginModule,
  type PluginModuleCache,
  type PluginModuleLoad,
} from "./host.tsx";
import { usePageNavigation } from "./index.tsx";
import { HostPluginPage, type HostPageNavigation } from "./page.tsx";

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

const log: PluginOwnedPageRegistration = {
  ownership: "plugin",
  pluginKey: placed.key,
  pluginId: "placed",
  source: "data",
  kind: "page",
  id: "placed.log",
  declaredId: "log",
  title: "Log",
  export: "LogPage",
};

/** Ответ обязан быть стабильным по ссылке: `useSyncExternalStore` сравнивает снимки именно ею. */
const pending: PluginModuleLoad = { kind: "loading" };

function cache(modules: Record<string, LoadedPluginModule>): PluginModuleCache {
  const loads = new Map<string, PluginModuleLoad>(
    Object.entries(modules).map(([key, module]) => [key, { kind: "loaded", module }]),
  );

  return {
    load: (status) => loads.get(status.key) ?? pending,
    peek: (status) => loads.get(status.key),
    version: () => 0,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
}

/** Страница, которая показывает всё, что ей дал хост, и умеет уйти по нажатию. */
function LogPage(): ReactNode {
  const navigation = usePageNavigation();

  return (
    <>
      <p>
        base:{navigation.basePath} path:{navigation.path} filter:
        {navigation.query.filter ?? "—"}
      </p>
      <button onClick={() => navigation.navigate("entry/3", { query: { filter: "warn" } })}>
        deeper
      </button>
      <button onClick={() => navigation.navigate("/../../elsewhere")}>escape</button>
      <button onClick={() => navigation.navigate("/..\\..\\settings/plugins")}>
        backslash escape
      </button>
      <button onClick={() => navigation.navigate("/%2e%2e\\.%2E\\settings/plugins")}>
        mixed backslash escape
      </button>
      <button onClick={() => navigation.navigate("/entry%5C..%5Clog")}>encoded backslash</button>
      <button onClick={() => navigation.navigate("/", { replace: true })}>root</button>
      <button onClick={() => navigation.navigateCore({ kind: "settings", section: "plugins" })}>
        leave
      </button>
    </>
  );
}

function host(
  overrides: Partial<HostPageNavigation> = {},
  page: ReactNode = <LogPage />,
): { navigation: HostPageNavigation; element: ReactNode } {
  const navigation: HostPageNavigation = {
    basePath: "/p/placed/log",
    rest: "",
    query: {},
    onNavigate: vi.fn(),
    onNavigateCore: vi.fn(),
    ...overrides,
  };

  return {
    navigation,
    element: (
      <BrowserRuntimeProvider
        contributions={[log]}
        plugins={[placed]}
        onDiagnostic={() => {}}
        events={{ subscribe: () => () => {} }}
        createCache={() => cache({})}
        cache={cache({ "data:placed": { LogPage: () => page } })}
      >
        <HostPluginPage registration={log} navigation={navigation} context={{}} fallback={null} />
      </BrowserRuntimeProvider>
    ),
  };
}

describe("usePageNavigation", () => {
  it("gives the page its base, its relative path and its parameters", () => {
    const { element } = host({ rest: "entry/3", query: { filter: "warn" } });

    render(element);

    expect(screen.getByText(/base:/).textContent).toBe(
      "base:/p/placed/log path:/entry/3 filter:warn",
    );
  });

  it("calls the page root a slash, not an empty string", () => {
    const { element } = host();

    render(element);

    expect(screen.getByText(/base:/).textContent).toContain("path:/ ");
  });

  it("navigates inside the page by a path from its base", () => {
    const { navigation, element } = host();

    render(element);
    fireEvent.click(screen.getByText("deeper"));

    expect(navigation.onNavigate).toHaveBeenCalledWith("/entry/3", { filter: "warn" }, false);
  });

  /** Уйти из своего поддерева страница не может: `..` выше базы упирается в базу, как в корень. */
  it("clamps a path that tries to climb above the base", () => {
    const { navigation, element } = host({ rest: "entry/3" });

    render(element);
    fireEvent.click(screen.getByText("escape"));

    expect(navigation.onNavigate).toHaveBeenCalledWith("/elsewhere", {}, false);
  });

  it.each([
    ["backslash escape", "/settings/plugins"],
    ["mixed backslash escape", "/settings/plugins"],
    ["encoded backslash", "/entry%5C..%5Clog"],
  ])(
    "treats raw backslashes as separators but keeps encoded ones as data for %s",
    (label, path) => {
      const { navigation, element } = host();

      render(element);
      fireEvent.click(screen.getByText(label));

      expect(navigation.onNavigate).toHaveBeenCalledWith(path, {}, false);
    },
  );

  it("passes replace through, because a filter must not fill the history", () => {
    const { navigation, element } = host();

    render(element);
    fireEvent.click(screen.getByText("root"));

    expect(navigation.onNavigate).toHaveBeenCalledWith("/", {}, true);
  });

  it("leaves for a core address by naming it, not by building its path", () => {
    const { navigation, element } = host();

    render(element);
    fireEvent.click(screen.getByText("leave"));

    expect(navigation.onNavigateCore).toHaveBeenCalledWith({
      kind: "settings",
      section: "plugins",
    });
  });

  /**
   * Вне страницы плагина хук — ошибка автора, а не состояние: рассказывать о ней данными некому.
   * Внутри страницы такое падение ловит граница экземпляра, и оболочка остаётся живой.
   */
  it("refuses to work outside a plugin page", () => {
    const Stray = (): ReactNode => {
      usePageNavigation();

      return <p>unreachable</p>;
    };

    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Stray />)).toThrow(/only inside a page of a plugin/);
  });

  it("keeps the shell alive when the page itself fails to render", () => {
    const complaints: string[] = [];
    const Broken = (): ReactNode => {
      throw new Error("no data");
    };

    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <BrowserRuntimeProvider
        contributions={[log]}
        plugins={[placed]}
        onDiagnostic={(text) => complaints.push(text)}
        events={{ subscribe: () => () => {} }}
        createCache={() => cache({})}
        cache={cache({ "data:placed": { LogPage: Broken } })}
      >
        <HostPluginPage
          registration={log}
          navigation={{
            basePath: "/p/placed/log",
            rest: "",
            query: {},
            onNavigate: () => {},
            onNavigateCore: () => {},
          }}
          context={{}}
          fallback={<p>fallback</p>}
        />
      </BrowserRuntimeProvider>,
    );

    expect(screen.getByText("fallback")).toBeTruthy();
    // Страница названа страницей: человек читает диагностику про то, что открыл.
    expect(complaints.join(" ")).toMatch(/the page placed\.log failed while rendering/);
  });
});

describe("HostPluginPage", () => {
  it("falls back while the bundle of the plugin is not there yet", () => {
    render(
      <BrowserRuntimeProvider
        contributions={[log]}
        plugins={[{ ...placed, state: "building", browser: undefined }]}
        onDiagnostic={() => {}}
        events={{ subscribe: () => () => {} }}
        createCache={() => cache({})}
      >
        <HostPluginPage
          registration={log}
          navigation={{
            basePath: "/p/placed/log",
            rest: "",
            query: {},
            onNavigate: () => {},
            onNavigateCore: () => {},
          }}
          context={{}}
          fallback={<p>waiting</p>}
        />
      </BrowserRuntimeProvider>,
    );

    expect(screen.getByText("waiting")).toBeTruthy();
  });

  /** Ревизия в ключе границы: новая сборка плагина — новый экземпляр, а не старый с новым кодом. */
  it("rebuilds the instance when the revision changes", () => {
    const mounted: string[] = [];
    const Page = (): ReactNode => <p>page</p>;
    const modules = cache({ "data:placed": { LogPage: Page } });
    const navigation: HostPageNavigation = {
      basePath: "/p/placed/log",
      rest: "",
      query: {},
      onNavigate: () => {},
      onNavigateCore: () => {},
    };
    const view = (revision: string) => (
      <BrowserRuntimeProvider
        contributions={[log]}
        plugins={[{ ...placed, browser: { revision, entry: `/assets/placed-${revision}.js` } }]}
        onDiagnostic={(text) => mounted.push(text)}
        events={{ subscribe: () => () => {} }}
        createCache={() => modules}
        cache={modules}
      >
        <HostPluginPage
          registration={log}
          navigation={navigation}
          context={{}}
          fallback={<p>none</p>}
        />
      </BrowserRuntimeProvider>
    );

    const { rerender, container } = render(view("r1"));
    const before = container.querySelector("p");
    rerender(view("r2"));

    expect(container.querySelector("p")).not.toBe(before);
  });
});
