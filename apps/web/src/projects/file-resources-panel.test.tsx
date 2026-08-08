// @vitest-environment jsdom

import type { FileResourcesSnapshot } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FileResourcesPanel } from "./file-resources-panel.tsx";
import { applyFileResourcesSnapshot, initialFileResourcesState } from "./file-resources-state.ts";

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const snapshot: FileResourcesSnapshot = {
  revision: 5,
  resources: [
    {
      kind: "agent",
      id: "code",
      name: "code",
      ownership: "standalone",
      scope: "project",
      source: "sovereign",
      path: "/project/.sovereign/agents/code/AGENT.md",
      state: "active",
    },
    {
      kind: "skill",
      id: "review",
      name: "review",
      ownership: "standalone",
      scope: "user",
      source: "agents",
      path: "/data/skills/review/SKILL.md",
      state: "active",
    },
    {
      kind: "skill",
      id: "old-review",
      name: "old-review",
      ownership: "plugin",
      scope: "built-in",
      source: "builtin",
      path: "/plugins/review/SKILL.md",
      state: "shadowed",
    },
    {
      kind: "agent",
      id: "off",
      name: "off",
      ownership: "plugin",
      scope: "user",
      source: "data",
      path: "/plugins/off/AGENT.md",
      state: "switched-off",
    },
    {
      kind: "skill",
      ownership: "standalone",
      scope: "project",
      source: "agents",
      path: "/project/.agents/skills/broken/SKILL.md",
      state: "invalid",
    },
  ],
  diagnostics: [
    {
      severity: "warning",
      code: "nonstandard-underscore",
      message: "underscore is not portable",
      path: "/data/skills/review/SKILL.md",
      kind: "skill",
      id: "review",
    },
    {
      severity: "error",
      code: "invalid-frontmatter",
      message: "name is required",
      path: "/project/.agents/skills/broken/SKILL.md",
      kind: "skill",
    },
  ],
};

describe("FileResourcesPanel", () => {
  it("groups the resource summary and its problems into named semantic sections", () => {
    render(
      <FileResourcesPanel
        state={applyFileResourcesSnapshot(initialFileResourcesState, snapshot)}
        translator={translator}
      />,
    );

    const resources = screen.getByRole("region", { name: "Файловые ресурсы" });
    const problemsSection = within(resources).getByRole("region", {
      name: "Проблемы и неактивные ресурсы",
    });
    const problemLists = within(problemsSection).getAllByRole("list");

    expect(
      resources.parentElement?.closest("section:not([aria-label]):not([aria-labelledby])"),
    ).toBeNull();
    expect(problemLists).toHaveLength(1);
    expect(problemLists[0]?.getAttribute("aria-label")).toBe("Проблемы файловых ресурсов");
    expect(within(problemLists[0] as HTMLElement).getAllByRole("listitem")).toHaveLength(5);
  });

  it("counts only active agents and skills and shows every diagnostic and inactive state", () => {
    render(
      <FileResourcesPanel
        state={applyFileResourcesSnapshot(initialFileResourcesState, snapshot)}
        translator={translator}
      />,
    );

    expect(screen.getByText("Активных агентов: 1")).toBeDefined();
    expect(screen.getByText("Активных скилов: 1")).toBeDefined();

    const problems = screen.getByRole("list", { name: "Проблемы файловых ресурсов" });
    expect(within(problems).getAllByRole("listitem")).toHaveLength(5);
    expect(problems.textContent).toContain("name is required");
    expect(problems.textContent).toContain("underscore is not portable");
    expect(problems.textContent).toContain("Затенён");
    expect(problems.textContent).toContain("Выключен");
    expect(problems.textContent).toContain("Некорректен");
    expect(problems.textContent).toContain("/project/.agents/skills/broken/SKILL.md");
    expect(problems.textContent).toContain("скил");
    expect(problems.textContent).toContain("agents · standalone · проект");
    expect(
      within(
        rowsForPath(problems, "/project/.agents/skills/broken/SKILL.md")[0] as HTMLElement,
      ).getByText("agents · standalone · проект"),
    ).toBeDefined();

    const rows = within(problems).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Ошибка");
    expect(rows[1]?.textContent).toContain("Предупреждение");
    expect(rows[2]?.textContent).toContain("Выключен");
    expect(rows[3]?.textContent).toContain("Затенён");
    expect(rows[4]?.textContent).toContain("Некорректен");
    expect(within(problems).queryByRole("button")).toBeNull();
  });

  it("uses flat settings rows for the resource summary and problems", () => {
    render(
      <FileResourcesPanel
        state={applyFileResourcesSnapshot(initialFileResourcesState, snapshot)}
        translator={translator}
      />,
    );

    expect(screen.getByRole("group", { name: "Файловые ресурсы" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Проблемы и неактивные ресурсы" })).toBeDefined();
  });

  it("shows zero active counts and a no-problems state for an empty snapshot", () => {
    render(
      <FileResourcesPanel
        state={applyFileResourcesSnapshot(initialFileResourcesState, {
          revision: 1,
          resources: [],
          diagnostics: [],
        })}
        translator={translator}
      />,
    );

    expect(screen.getByText("Активных агентов: 0")).toBeDefined();
    expect(screen.getByText("Активных скилов: 0")).toBeDefined();
    expect(screen.getByText("Проблем нет")).toBeDefined();
  });

  it("localizes loading and read failures", () => {
    const view = render(
      <FileResourcesPanel state={initialFileResourcesState} translator={translator} />,
    );
    expect(screen.getByRole("status").textContent).toContain("Файловые ресурсы загружаются");

    view.rerender(
      <FileResourcesPanel
        state={{ ...initialFileResourcesState, failure: "folder unavailable" }}
        translator={translator}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("folder unavailable");
  });
});

function rowsForPath(list: HTMLElement, path: string): HTMLElement[] {
  return within(list)
    .getAllByRole("listitem")
    .filter((row) => row.textContent?.includes(path));
}
