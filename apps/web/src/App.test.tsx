// @vitest-environment jsdom

import { createElement, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appearanceCacheKey,
  cacheAppearance,
  defaultAppearancePreferences,
  fetchAppearance,
} from "./appearance.ts";
import { App } from "./App.tsx";

const selectProject = vi.fn();
let lastNewSessionContext: unknown;
let lastTabsRequest: { id: string; context: unknown } | undefined;
let placeTabs: { id: string; label: string; content: ReactNode }[] = [];
let lastUsagePlace: { context: unknown; builtIn?: ReactNode } | undefined;

function testStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

const project = {
  id: "p1",
  name: "Project one",
  folder: "/projects/one",
  folderKey: "/projects/one",
  archived: false,
  availability: "available",
  sessionCount: 0,
  ephemeral: false,
  createdAt: "2026-08-09T00:00:00.000Z",
};
const pluginsHook = {
  state: { snapshot: { contributions: [], plugins: [] } },
  switchPlugin: vi.fn(),
};

vi.mock("./session.ts", () => ({
  logIn: vi.fn(),
  logOut: vi.fn(),
  probeSession: vi.fn(async () => ({ kind: "state", state: "authenticated" })),
  register: vi.fn(),
}));

vi.mock("./events/stream.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./events/stream.ts")>();

  return {
    ...original,
    connectEventStream: vi.fn(() => ({ status: () => "connecting", close: vi.fn() })),
  };
});

vi.mock("./appearance.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./appearance.ts")>();

  return {
    ...original,
    fetchAppearance: vi.fn(async () => defaultAppearancePreferences),
  };
});

vi.mock("./plugins/use-plugins.ts", () => ({
  usePlugins: () => pluginsHook,
}));

vi.mock("./settings/use-config.ts", () => ({
  useConfig: () => ({
    state: { config: undefined, failure: undefined, refusal: undefined },
    update: vi.fn(),
  }),
}));

vi.mock("./projects/use-projects.ts", () => ({
  useProjects: () => ({
    state: { snapshot: { projects: [project], archived: [] }, failure: undefined },
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    dismissComplaints: vi.fn(),
  }),
}));

vi.mock("./projects/use-file-resources.ts", () => ({
  useFileResources: () => ({ stale: false }),
}));

vi.mock("./providers/use-providers.ts", () => ({
  useProviders: () => ({
    state: { snapshot: { providers: [] }, failure: undefined },
    logIn: vi.fn(),
    answer: vi.fn(),
    cancelLogin: vi.fn(),
    closeLogin: vi.fn(),
    logOut: vi.fn(),
    receiveLoginStep: vi.fn(),
  }),
}));

vi.mock("./sessions/use-sessions.ts", () => ({
  useSessions: () => ({
    state: {
      sessions: [],
      projects: [project],
      providers: [],
      models: {},
      open: undefined,
      failure: undefined,
    },
    projectAgents: { loading: false },
    selectProject,
    prepareDraft: vi.fn(),
    prepareModels: vi.fn(),
    loadModels: vi.fn(),
    createSession: vi.fn(),
    submitTurn: vi.fn(),
    submitTurnToSession: vi.fn(),
    sendMessage: vi.fn(),
    interrupt: vi.fn(),
    compact: vi.fn(),
    navigate: vi.fn(),
    setEntryLabel: vi.fn(),
    updateSession: vi.fn(),
    removeSession: vi.fn(),
    forkSession: vi.fn(),
    setShowArchived: vi.fn(),
    receiveSessionDelta: vi.fn(),
  }),
}));

vi.mock("./places/place-host.tsx", () => ({
  BrowserRuntimeProvider: (props: { children?: ReactNode }) => props.children,
  HostPlaceCollection: () => null,
  useHostPlaceTabs: (props: { id: string; context: unknown }) => {
    lastTabsRequest = props;

    return placeTabs;
  },
  HostPlace: (props: { id: string; context: unknown; builtIn?: ReactNode }) => {
    if (props.id === "core.session.new") {
      lastNewSessionContext = props.context;
    }

    if (props.id === "core.settings.usage") {
      lastUsagePlace = { context: props.context, builtIn: props.builtIn };
    }

    return props.builtIn;
  },
}));

vi.mock("./projects/project-detail-view.tsx", () => ({
  ProjectDetailView: (props: { onNewSession: () => void }) =>
    createElement("button", { onClick: props.onNewSession }, "new in project"),
}));

vi.mock("./sessions/new-session-view.tsx", () => ({
  NewSessionView: (props: { initialProjectId?: string; onSelectProject: (id: string) => void }) => {
    const [projectId, setProjectId] = useState(props.initialProjectId ?? "");

    return createElement(
      "div",
      null,
      createElement("output", { "data-testid": "draft-project" }, projectId || "none"),
      createElement(
        "button",
        {
          onClick: () => {
            setProjectId("p2");
            props.onSelectProject("p2");
          },
        },
        "select p2",
      ),
    );
  },
}));

vi.mock("./sessions/sidebar-projects.tsx", () => ({
  SidebarProjects: (props: { onNewSession: (projectId: string) => void }) =>
    createElement("button", { onClick: () => props.onNewSession("p1") }, "sidebar new"),
}));

vi.mock("./shell/account-control.tsx", () => ({ AccountControl: () => null }));
vi.mock("./projects/projects-view.tsx", () => ({ ProjectsView: () => null }));
vi.mock("./projects/file-resources-panel.tsx", () => ({ FileResourcesPanel: () => null }));
vi.mock("./providers/providers-view.tsx", () => ({ ProvidersView: () => null }));
vi.mock("./providers/user-provider-form.tsx", () => ({ UserProviderForm: () => null }));
vi.mock("./plugins/plugins-view.tsx", () => ({ PluginsView: () => null }));
vi.mock("./plugins/plugin-detail-view.tsx", () => ({ PluginDetailView: () => null }));
vi.mock("./sessions/archive-sessions-view.tsx", () => ({ ArchiveSessionsView: () => null }));
vi.mock("./sessions/session-route-view.tsx", () => ({
  SessionRouteView: (props: { children: ReactNode }) => props.children,
}));
vi.mock("./sessions/chat-view.tsx", () => ({ ChatView: () => null }));
vi.mock("./settings/daemon-section.tsx", () => ({ DaemonSection: () => null }));
vi.mock("./settings/diagnostics-section.tsx", () => ({ DiagnosticsSection: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  lastNewSessionContext = undefined;
  lastTabsRequest = undefined;
  placeTabs = [];
  lastUsagePlace = undefined;
});

beforeEach(() => {
  vi.stubGlobal("localStorage", testStorage());
  localStorage.clear();
  history.replaceState(null, "", "/");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.mocked(fetchAppearance).mockResolvedValue(defaultAppearancePreferences);
});

describe("App shell composition", () => {
  it("uses page mode for the new-session route and contained mode for an open session", async () => {
    history.replaceState(null, "", "/sessions/new");
    const newSession = render(<App />);

    await screen.findByRole("navigation", { name: "Navigation" });
    expect(screen.getByRole("main").getAttribute("data-content-mode")).toBe("page");

    newSession.unmount();
    history.replaceState(null, "", "/sessions/a1b2c3d4");
    render(<App />);

    await screen.findByRole("navigation", { name: "Navigation" });
    expect(screen.getByRole("main").getAttribute("data-content-mode")).toBe("contained");
  });

  /**
   * Правая панель общая на всё окно, поэтому контекста проекта у её вкладок нет: плагин из папки
   * открытого проекта не вправе принести туда вкладку.
   */
  it("fills the right panel from the tabs place, in the page context and without a project", async () => {
    placeTabs = [
      { id: "placed.board", label: "Board", content: createElement("p", null, "доска") },
    ];
    render(<App />);

    await screen.findByRole("navigation", { name: "Navigation" });

    expect(lastTabsRequest).toEqual({
      id: "core.panel.tabs",
      context: { subject: { page: "home" } },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show the side panel" }));

    // Открытая панель всегда показывает вкладку: щёлкать по единственной, чтобы её увидеть, незачем.
    expect(screen.getByRole("radio", { name: "Board" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("доска")).toBeDefined();
  });

  it("names the open session in the context of the window places", async () => {
    placeTabs = [
      { id: "placed.board", label: "Board", content: createElement("p", null, "доска") },
    ];
    history.replaceState(null, "", "/sessions/a1b2c3d4");
    render(<App />);

    await screen.findByRole("navigation", { name: "Navigation" });

    // Вкладке правой панели незачем читать адрес самой: какой разговор открыт — часть предмета
    // места. Проекта в контексте по-прежнему нет: он решает, кто вправе занять место.
    expect(lastTabsRequest).toEqual({
      id: "core.panel.tabs",
      context: { subject: { page: "session", sessionId: "a1b2c3d4" } },
    });
  });

  it("wires the localized product brand and real new-session action into authenticated navigation", async () => {
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "Navigation" });

    const productName = within(navigation).getByText("Sovereign");

    expect(productName.parentElement?.querySelector('img[alt=""]')).not.toBeNull();
    expect(within(navigation).getByRole("button", { name: "+ New session" })).toBeDefined();
  });

  it("previews Imperium while preserving a disappeared saved plugin scheme", async () => {
    const missing = {
      ...defaultAppearancePreferences,
      appearance: {
        ...defaultAppearancePreferences.appearance,
        colorScheme: "themed.missing",
        variant: "dark" as const,
      },
    };
    cacheAppearance(localStorage, missing);
    vi.mocked(fetchAppearance).mockResolvedValue(missing);
    history.replaceState(null, "", "/settings/appearance");

    render(<App />);

    expect(
      await screen.findByRole("region", {
        name: "Preview: Imperium (purple and gold), Dark, Normal",
      }),
    ).toBeTruthy();
    await waitFor(() => {
      const cached = JSON.parse(localStorage.getItem(appearanceCacheKey) ?? "{}") as {
        appearance?: { colorScheme?: string };
      };
      expect(cached.appearance?.colorScheme).toBe("themed.missing");
    });
  });

  it("wires the canonical usage route into Settings without requesting before the stream opens", async () => {
    history.replaceState(null, "", "/settings/usage");

    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Usage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Usage" }).getAttribute("aria-current")).toBe("page");
    expect(
      within(screen.getByRole("region", { name: "Usage" })).getByRole("status").textContent,
    ).toBe("Loading usage…");
    expect(lastUsagePlace?.context).toEqual({});
    expect(lastUsagePlace?.builtIn).toBeDefined();
  });
});

describe("new-session route project context", () => {
  it("keeps project context synchronized for the route lifetime and clears on exit", async () => {
    history.replaceState(null, "", "/settings/projects/p1");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "new in project" }));

    await waitFor(() => expect(window.location.pathname).toBe("/sessions/new"));
    expect(screen.getByTestId("draft-project").textContent).toBe("p1");
    expect(lastNewSessionContext).toEqual({ project: "p1" });

    fireEvent.click(screen.getByRole("button", { name: "select p2" }));
    expect(screen.getByTestId("draft-project").textContent).toBe("p2");
    expect(lastNewSessionContext).toEqual({ project: "p2" });
    expect(selectProject).toHaveBeenLastCalledWith("p2");

    fireEvent.click(screen.getByRole("button", { name: /\+ .*session/i }));
    expect(screen.getByTestId("draft-project").textContent).toBe("none");
    expect(lastNewSessionContext).toEqual({});

    window.history.pushState(undefined, "", "/settings/projects/p1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/projects/p1"));
    fireEvent.click(screen.getByRole("button", { name: /\+ .*session/i }));
    await waitFor(() => expect(window.location.pathname).toBe("/sessions/new"));
    expect(screen.getByTestId("draft-project").textContent).toBe("none");
    expect(lastNewSessionContext).toEqual({});
  });

  it("resets the form when the sidebar explicitly opens another project on the same route", async () => {
    history.replaceState(null, "", "/settings/projects/p1");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "new in project" }));
    await waitFor(() => expect(window.location.pathname).toBe("/sessions/new"));

    fireEvent.click(screen.getByRole("button", { name: "select p2" }));
    expect(screen.getByTestId("draft-project").textContent).toBe("p2");

    fireEvent.click(screen.getByRole("button", { name: "sidebar new" }));

    expect(screen.getByTestId("draft-project").textContent).toBe("p1");
    expect(lastNewSessionContext).toEqual({ project: "p1" });
  });
});
