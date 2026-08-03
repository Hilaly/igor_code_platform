// @vitest-environment jsdom

import type { Project, Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  agentId: "base-agent.agent",
  agentAvailable: true,
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  phase: "idle",
  archived: false,
  title: "Session A",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
};

function show(overrides: Partial<React.ComponentProps<typeof SidebarProjects>> = {}) {
  const handlers = {
    onOpenSession: vi.fn(),
    onNewSession: vi.fn(),
    onUpdateProject: vi.fn(),
    onRemoveProject: vi.fn(),
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
