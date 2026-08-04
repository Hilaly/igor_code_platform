// @vitest-environment jsdom

import type { Project } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectDetailView } from "./project-detail-view.tsx";

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
  sessionCount: 3,
  ephemeral: false,
  createdAt: "2026-08-02T00:00:00.000Z",
};

describe("ProjectDetailView", () => {
  it("shows the project summary and resources without a duplicated session list", () => {
    render(
      <ProjectDetailView
        project={project}
        loaded
        fileResources={<div>Файловые ресурсы проекта</div>}
        onBack={vi.fn()}
        onNewSession={vi.fn()}
        translator={translator}
      />,
    );

    expect(screen.getByRole("heading", { name: "Alpha" })).toBeDefined();
    expect(screen.getByText("/code/alpha")).toBeDefined();
    expect(screen.getByText("Сессий: 3")).toBeDefined();
    expect(screen.queryByText("Список сессий проекта")).toBeNull();
    expect(screen.getByText("Файловые ресурсы проекта")).toBeDefined();
  });

  it("keeps one page heading and a named action toolbar outside the detail object", () => {
    render(
      <ProjectDetailView
        project={project}
        loaded
        onBack={vi.fn()}
        onNewSession={vi.fn()}
        translator={translator}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Alpha" });
    const toolbar = screen.getByRole("toolbar", { name: "Проекты" });
    const detail = heading.closest("section");

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(detail).not.toBeNull();
    expect(detail?.contains(toolbar)).toBe(false);
  });

  it("navigates back and starts a new session", () => {
    const onBack = vi.fn();
    const onNewSession = vi.fn();

    render(
      <ProjectDetailView
        project={project}
        loaded
        onBack={onBack}
        onNewSession={onNewSession}
        translator={translator}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "← Все проекты" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая сессия" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it("shows a stable empty state for a missing project", () => {
    render(
      <ProjectDetailView loaded onBack={vi.fn()} onNewSession={vi.fn()} translator={translator} />,
    );

    expect(screen.getByText("Проект не найден")).toBeDefined();
  });
});
