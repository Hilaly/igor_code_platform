// @vitest-environment jsdom

import type { Project, Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  agentId: "base-agent.agent",
  agentAvailable: true,
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  phase: "idle",
  archived: true,
  title: "Session A",
  createdAt: "2026-08-01T00:00:00.000Z",
};

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

it("restores and permanently removes an archived session", () => {
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

  fireEvent.click(screen.getByRole("button", { name: /Действия над сессией Session A/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));
  expect(onRemove).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить безвозвратно" }),
  );
  expect(onRemove).toHaveBeenCalledWith("0199");
});
