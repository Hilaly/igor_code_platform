// @vitest-environment jsdom

import type { Project, Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ArchiveSessionsView } from "./archive-sessions-view.tsx";

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
  archived: true,
  title: "Session A",
  createdAt: "2026-08-01T00:00:00.000Z",
};

it("exposes every project archive as a named section with one list", () => {
  const secondSession = {
    ...session,
    id: "0200",
    projectId: "beta",
    folder: "/code/beta",
    title: "Session B",
  };
  const secondProject = { ...project, id: "beta", name: "Beta" };

  render(
    <ArchiveSessionsView
      sessions={[session, secondSession]}
      projects={[project, secondProject]}
      loaded
      onOpen={vi.fn()}
      onRestore={vi.fn()}
      onRemove={vi.fn()}
      translator={translator}
    />,
  );

  const sections = screen.getAllByRole("region");
  expect(sections).toHaveLength(2);

  for (const [name, archivedSession] of [
    ["Alpha", session],
    ["Beta", secondSession],
  ] as const) {
    const section = screen.getByRole("region", { name });
    expect(within(section).getAllByRole("heading", { level: 2 })).toHaveLength(1);
    const list = within(section).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText(archivedSession.title ?? archivedSession.id)).toBeDefined();
  }
});

it("groups archived sessions by project and opens their history", () => {
  const onOpen = vi.fn();
  render(
    <ArchiveSessionsView
      sessions={[session]}
      projects={[project]}
      loaded
      onOpen={onOpen}
      onRestore={vi.fn()}
      onRemove={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Session A/code/alpha" }));
  expect(onOpen).toHaveBeenCalledWith("0199");
});

it("restores and permanently removes an archived session", async () => {
  const onRestore = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn().mockResolvedValue(undefined);
  render(
    <ArchiveSessionsView
      sessions={[session]}
      projects={[project]}
      loaded
      onOpen={vi.fn()}
      onRestore={onRestore}
      onRemove={onRemove}
      translator={translator}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Вернуть из архива" }));
  expect(onRestore).toHaveBeenCalledWith(session);
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));
  expect(onRemove).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить безвозвратно" }),
  );
  expect(onRemove).toHaveBeenCalledWith("0199");
});

it("shows a refusal when restoring an archived session fails", async () => {
  render(
    <ArchiveSessionsView
      sessions={[session]}
      projects={[project]}
      loaded
      onOpen={vi.fn()}
      onRestore={vi.fn().mockResolvedValue("session is busy")}
      onRemove={vi.fn()}
      translator={translator}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Вернуть из архива" }));

  await waitFor(() => expect(screen.getByText(/session is busy/)).toBeTruthy());
});

it("keeps the delete confirmation open when deletion fails", async () => {
  render(
    <ArchiveSessionsView
      sessions={[session]}
      projects={[project]}
      loaded
      onOpen={vi.fn()}
      onRestore={vi.fn().mockResolvedValue(undefined)}
      onRemove={vi.fn().mockResolvedValue("session is busy")}
      translator={translator}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить безвозвратно" }),
  );

  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(screen.getByText(/session is busy/)).toBeTruthy();
});
