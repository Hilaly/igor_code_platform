// @vitest-environment jsdom

import { createElement, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectProject = vi.fn();
let lastNewSessionContext: unknown;

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

vi.mock("@sovereign/ui-kit", () => ({
  Button: (props: { children?: ReactNode; onClick?: () => void }) =>
    createElement("button", { onClick: props.onClick }, props.children),
  Heading: (props: { children?: ReactNode }) => createElement("h2", null, props.children),
  Spinner: () => null,
  coreNamespace: "core",
  createTranslator: () => ({ t: (key: string) => key }),
  coreEnglish: {},
  coreRussian: {},
}));

vi.mock("./session.ts", () => ({
  probeSession: () => Promise.resolve({ kind: "state", state: "authenticated" }),
  logIn: vi.fn(),
  logOut: vi.fn(() => Promise.resolve()),
  register: vi.fn(),
}));
vi.mock("./events/stream.ts", () => ({
  connectEventStream: () => ({ close: vi.fn() }),
}));
vi.mock("./appearance.ts", () => ({
  applyAppearance: vi.fn(),
  cacheAppearance: vi.fn(),
  defaultAppearancePreferences: { locale: "ru", scheme: "imperium" },
  describeSchemes: () => [],
  fetchAppearance: () => Promise.resolve({ locale: "ru", scheme: "imperium" }),
  pluginColorSchemes: () => ({ schemes: [], refusals: [] }),
  readCachedAppearance: () => undefined,
  shippedSchemes: [],
  writeAppearance: () => Promise.resolve({ locale: "ru", scheme: "imperium" }),
}));
vi.mock("./catalogs.ts", () => ({
  availableLocales: () => ["ru"],
  pluginCatalogs: () => [],
  shippedCatalogs: [],
}));
vi.mock("./diagnostics.ts", () => ({
  createDiagnosticsStore: () => ({ record: vi.fn(), subscribe: () => () => {} }),
}));
vi.mock("./plugins/use-plugins.ts", () => ({
  usePlugins: () => ({
    state: { snapshot: { contributions: [], plugins: [] } },
    switchPlugin: vi.fn(),
  }),
}));
vi.mock("./settings/use-config.ts", () => ({
  useConfig: () => ({
    state: { config: undefined, failure: undefined, refusal: undefined },
    save: vi.fn(),
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
  HostPlace: (props: { id: string; context: unknown; builtIn?: ReactNode }) => {
    if (props.id === "core.session.new") {
      lastNewSessionContext = props.context;
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
vi.mock("./shell/shell.tsx", () => ({
  Shell: (props: { navigation: ReactNode; navigationHeader: ReactNode; children: ReactNode }) =>
    createElement("div", null, props.navigationHeader, props.navigation, props.children),
}));
vi.mock("./shell/page.tsx", () => ({
  describePage: () => "page",
  PageView: (props: { page: { kind: string }; settings: ReactNode; newSession: ReactNode }) =>
    props.page.kind === "new-session" ? props.newSession : props.settings,
}));
vi.mock("./sessions/sidebar-projects.tsx", () => ({
  SidebarProjects: (props: { onNewSession: (projectId: string) => void }) =>
    createElement("button", { onClick: () => props.onNewSession("p1") }, "sidebar new"),
}));
vi.mock("./login/login-view.tsx", () => ({ LoginView: () => null }));
vi.mock("./shell/account-control.tsx", () => ({ AccountControl: () => null }));
vi.mock("./settings/settings-view.tsx", () => ({
  SettingsView: (props: { projects: ReactNode }) => props.projects,
}));
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
vi.mock("./settings/appearance-section.tsx", () => ({ AppearanceSection: () => null }));
vi.mock("./settings/daemon-section.tsx", () => ({ DaemonSection: () => null }));
vi.mock("./settings/diagnostics-section.tsx", () => ({ DiagnosticsSection: () => null }));

import { App } from "./App.tsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.matchMedia = (() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(undefined, "", "/settings/projects/p1");
  lastNewSessionContext = undefined;
});

describe("new-session route project context", () => {
  it("keeps project context synchronized for the route lifetime and clears on exit", async () => {
    render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "new in project" }));

    await waitFor(() => expect(window.location.pathname).toBe("/sessions/new"));
    expect(screen.getByTestId("draft-project").textContent).toBe("p1");
    expect(lastNewSessionContext).toEqual({ project: "p1" });

    fireEvent.click(screen.getByRole("button", { name: "select p2" }));
    expect(screen.getByTestId("draft-project").textContent).toBe("p2");
    expect(lastNewSessionContext).toEqual({ project: "p2" });
    expect(selectProject).toHaveBeenLastCalledWith("p2");

    fireEvent.click(screen.getByRole("button", { name: "+ sessions.new" }));
    expect(screen.getByTestId("draft-project").textContent).toBe("none");
    expect(lastNewSessionContext).toEqual({});

    window.history.pushState(undefined, "", "/settings/projects/p1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/projects/p1"));
    fireEvent.click(screen.getByRole("button", { name: "+ sessions.new" }));
    await waitFor(() => expect(window.location.pathname).toBe("/sessions/new"));
    expect(screen.getByTestId("draft-project").textContent).toBe("none");
    expect(lastNewSessionContext).toEqual({});
  });

  it("resets the form when the sidebar explicitly opens another project on the same route", async () => {
    render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "new in project" }));
    await waitFor(() => expect(window.location.pathname).toBe("/sessions/new"));

    fireEvent.click(screen.getByRole("button", { name: "select p2" }));
    expect(screen.getByTestId("draft-project").textContent).toBe("p2");

    fireEvent.click(screen.getByRole("button", { name: "sidebar new" }));

    expect(screen.getByTestId("draft-project").textContent).toBe("p1");
    expect(lastNewSessionContext).toEqual({ project: "p1" });
  });
});
