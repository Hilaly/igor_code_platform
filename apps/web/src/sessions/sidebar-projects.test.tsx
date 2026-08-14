// @vitest-environment jsdom

import type { Project, Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SidebarProjects } from "./sidebar-projects.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const project: Project = {
  id: "alpha",
  name: "Alpha",
  folder: "/code/alpha",
  folderKey: "/code/alpha",
  archived: false,
  availability: "available",
  sessionCount: 1,
  ephemeral: false,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const session: Session = {
  id: "0199",
  projectId: "alpha",
  folder: "/code/alpha",
  agentId: "starter.generic",
  agentAvailable: true,
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  phase: "idle",
  archived: false,
  hidden: false,
  title: "Session A",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const longProjectName =
  "A project name long enough to be truncated without losing its complete meaning";
const longSessionTitle =
  "A session title long enough to be truncated without losing its complete meaning";

const longProject: Project = {
  ...project,
  name: longProjectName,
};

const longSession: Session = {
  ...session,
  title: longSessionTitle,
};

const longFolder = "/Users/user/repos/sovereign_platform_node";
const shortenedLongFolder = "/Users/use…form_node";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
};

function show(overrides: Partial<React.ComponentProps<typeof SidebarProjects>> = {}) {
  const handlers = {
    onOpenSession: vi.fn(),
    onNewSession: vi.fn(),
    onUpdateProject: vi.fn().mockResolvedValue(undefined),
    onRemoveProject: vi.fn().mockResolvedValue(undefined),
    onUpdateSession: vi.fn().mockResolvedValue(undefined),
    onRemoveSession: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <SidebarProjects
      projects={[project]}
      sessions={[session]}
      selectedSessionId={undefined}
      storage={storage}
      translator={translator}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

it("expands projects, persists the layout, and opens a child session", () => {
  values.clear();
  const { onOpenSession } = show();

  fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));
  expect(screen.getByRole("treeitem", { name: "Session A" })).toBeTruthy();
  expect(JSON.parse(storage.getItem("sovereign.sidebar.expanded-projects") ?? "[]")).toEqual([
    "alpha",
  ]);
  fireEvent.click(screen.getByRole("treeitem", { name: "Session A" }));
  expect(onOpenSession).toHaveBeenCalledWith("0199");
});

it("leaves hidden sessions out of the tree", () => {
  values.clear();
  show({
    sessions: [session, { ...session, id: "0200", title: "Subagent", hidden: true }],
  });

  fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));

  // Скрытую сессию завёл плагин для своей работы: она жива и открывается по прямому адресу, но в
  // дереве человека ей не место.
  expect(screen.getByRole("treeitem", { name: "Session A" })).toBeTruthy();
  expect(screen.queryByRole("treeitem", { name: "Subagent" })).toBeNull();
});

it("toggles a project by clicking anywhere on its row", () => {
  values.clear();
  show();

  const projectRow = screen.getByRole("treeitem", { name: "Alpha" });
  fireEvent.click(projectRow);
  expect(screen.getByRole("treeitem", { name: "Session A" })).toBeTruthy();
  expect(projectRow.getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(projectRow);
  expect(screen.queryByRole("treeitem", { name: "Session A" })).toBeNull();
  expect(projectRow.getAttribute("aria-expanded")).toBe("false");
});

it("expands the selected session project on first render", () => {
  values.clear();
  show({ selectedSessionId: "0199" });
  expect(screen.getByRole("treeitem", { name: "Session A" }).getAttribute("aria-selected")).toBe(
    "true",
  );
});

it("creates a session in a project without selecting the row", () => {
  values.clear();
  const { onNewSession, onOpenSession } = show();
  fireEvent.click(screen.getByRole("button", { name: "Новая сессия в Alpha" }));
  expect(onNewSession).toHaveBeenCalledWith("alpha");
  expect(onOpenSession).not.toHaveBeenCalled();
});

it("shows folder-led projects and contextual project and session facts", () => {
  values.clear();
  show();

  const projectItem = screen.getByRole("treeitem", { name: "Alpha" });
  expect(projectItem.querySelector("svg")).toBeTruthy();
  fireEvent.pointerEnter(projectItem);
  expect(screen.getByRole("tooltip", { name: "Alpha" })).toBeTruthy();
  expect(screen.getByText("/code/alpha")).toBeTruthy();
  expect(screen.getByText("1 активная сессия")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));
  const sessionItem = screen.getByRole("treeitem", { name: "Session A" });
  fireEvent.pointerEnter(sessionItem);
  expect(screen.getByRole("tooltip", { name: "Session A" })).toBeTruthy();
  expect(screen.getByText("Проект: Alpha")).toBeTruthy();
  expect(screen.getByText(/Создана/)).toBeTruthy();
});

it("shortens contextual paths to twenty characters and preserves the full value", () => {
  values.clear();
  show({
    projects: [{ ...project, folder: longFolder, folderKey: longFolder }],
    sessions: [{ ...session, folder: longFolder }],
  });

  const projectItem = screen.getByRole("treeitem", { name: "Alpha" });
  fireEvent.pointerEnter(projectItem);
  expect(screen.getByText(shortenedLongFolder).getAttribute("title")).toBe(longFolder);
  expect(Array.from(shortenedLongFolder)).toHaveLength(20);

  fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));
  const sessionItem = screen.getByRole("treeitem", { name: "Session A" });
  fireEvent.pointerEnter(sessionItem);
  expect(screen.getByText(shortenedLongFolder).getAttribute("title")).toBe(longFolder);
});

it("keeps truncated project and session names available to people and actions", () => {
  values.clear();
  const { onOpenSession, onNewSession } = show({
    projects: [longProject],
    sessions: [longSession],
  });

  const projectItem = screen.getByRole("treeitem", { name: longProjectName });
  expect(projectItem.getAttribute("title")).toBe(longProjectName);
  expect(screen.getByRole("button", { name: `Новая сессия в ${longProjectName}` })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: `Действия над проектом ${longProjectName}` }),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: `Действия над проектом ${longProjectName}` }));
  expect(screen.queryByRole("treeitem", { name: longSessionTitle })).toBeNull();
  expect(onOpenSession).not.toHaveBeenCalled();
  expect(onNewSession).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: `Развернуть ${longProjectName}` }));
  const sessionItem = screen.getByRole("treeitem", { name: longSessionTitle });
  expect(sessionItem.getAttribute("title")).toBe(longSessionTitle);

  fireEvent.click(screen.getByRole("button", { name: `Действия над сессией ${longSessionTitle}` }));
  expect(onOpenSession).not.toHaveBeenCalled();
});

it("shows loading and refresh failures without hiding a stale tree", () => {
  show({
    projectsLoading: true,
    sessionsFailure: "offline",
  });

  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.getByText(/offline/)).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "Alpha" })).toBeTruthy();
});

it("shows a refused session action", async () => {
  values.clear();
  show({ onUpdateSession: vi.fn().mockResolvedValue("session is busy") });
  fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "В архив" }));

  await waitFor(() => expect(screen.getByText(/session is busy/)).toBeTruthy());
});

it("renames, archives, and removes a project through row actions", async () => {
  values.clear();
  const { onUpdateProject, onRemoveProject } = show();

  fireEvent.click(screen.getByRole("button", { name: "Действия над проектом Alpha" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Имя" }), { target: { value: "Beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Переименовать" }));
  await waitFor(() =>
    expect(onUpdateProject).toHaveBeenCalledWith("alpha", { name: "Beta", archived: false }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Действия над проектом Alpha" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "В архив" }));
  await waitFor(() =>
    expect(onUpdateProject).toHaveBeenCalledWith("alpha", { name: "Alpha", archived: true }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Действия над проектом Alpha" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Удалить/ }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить безвозвратно" }));
  await waitFor(() => expect(onRemoveProject).toHaveBeenCalledWith("alpha"));
});

it("keeps a project rename dialog open when the write is refused", async () => {
  values.clear();
  show({ onUpdateProject: vi.fn().mockResolvedValue("project is busy") });

  fireEvent.click(screen.getByRole("button", { name: "Действия над проектом Alpha" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Имя" }), { target: { value: "Beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Переименовать" }));

  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(screen.getByText(/project is busy/)).toBeTruthy();
});

it("keeps a project delete confirmation open when deletion is refused", async () => {
  values.clear();
  show({ onRemoveProject: vi.fn().mockResolvedValue("project is busy") });

  fireEvent.click(screen.getByRole("button", { name: "Действия над проектом Alpha" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Удалить/ }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить безвозвратно" }));

  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(screen.getByText(/project is busy/)).toBeTruthy();
});

it("keeps a session rename dialog open when the write is refused", async () => {
  values.clear();
  show({ onUpdateSession: vi.fn().mockResolvedValue("session is busy") });
  fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Имя" }), { target: { value: "Beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Переименовать" }));

  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(screen.getByText(/session is busy/)).toBeTruthy();
});

it("keeps a session delete confirmation open when deletion is refused", async () => {
  values.clear();
  show({ onRemoveSession: vi.fn().mockResolvedValue("session is busy") });
  fireEvent.click(screen.getByRole("button", { name: "Развернуть Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить безвозвратно" }));

  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(screen.getByText(/session is busy/)).toBeTruthy();
});
