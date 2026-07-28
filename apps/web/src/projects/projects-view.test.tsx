// @vitest-environment jsdom

/**
 * Вью проектов на настоящем DOM. Проверяется то, чего не видно ни в разметке первого кадра, ни
 * глазами за один проход: что у эфемерного проекта нет ни одного действия, что подтверждение
 * удаления называет число сессий, что отказ «путь занят» подсвечивает занявшую строку, а не только
 * пишет текст, и что форма не теряет введённое после отказа.
 *
 * Переводчик здесь бросает на любой ненайденный ключ: непереведённая строка в интерфейсе — не
 * «мелочь на потом», а то, ради чего диагностика вообще заведена (docs/ui-kit.md).
 */

import type { Project, ProjectsSnapshot } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectsView, type ProjectsViewProps } from "./projects-view.tsx";
import { applyConflict, applySnapshot, initialProjectsState, type ProjectsState } from "./state.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

let created = 0;

const project = (id: string, overrides: Partial<Project> = {}): Project => {
  created += 1;

  return {
    id,
    name: id,
    folder: `/code/${id}`,
    folderKey: `/code/${id}`,
    archived: false,
    availability: "available",
    sessionCount: 0,
    ephemeral: false,
    createdAt: new Date(created * 1_000).toISOString(),
    ...overrides,
  };
};

const work = project("work", { name: "work", ephemeral: true, folder: "/data/work" });

const snapshot = (projects: Project[], archived: Project[] = []): ProjectsSnapshot => ({
  projects,
  archived,
});

function show(state: ProjectsState, overrides: Partial<ProjectsViewProps> = {}) {
  const onCreate = vi.fn().mockResolvedValue(true);
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const onDismissComplaints = vi.fn();

  render(
    <ProjectsView
      state={state}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onDismissComplaints={onDismissComplaints}
      translator={translator}
      {...overrides}
    />,
  );

  return { onCreate, onUpdate, onRemove, onDismissComplaints };
}

const withProjects = (projects: Project[], archived: Project[] = []): ProjectsState =>
  applySnapshot(initialProjectsState, snapshot(projects, archived));

/** Меню действий строки: у каждой оно своё, поэтому ищется внутри своей строки. */
const rowOf = (name: string): HTMLElement => {
  const label = screen.getByText(name);
  const row = label.closest("li");

  if (row === null) {
    throw new Error(`the row of ${name} was not found`);
  }

  return row;
};

const openActions = (name: string): void => {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: /Действия/ }));
};

describe("ProjectsView", () => {
  it("waits for the first snapshot instead of showing an empty list", () => {
    show(initialProjectsState);

    expect(screen.queryByText("Проектов ещё нет")).toBeNull();
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("says why the list could not be read", () => {
    show({ stale: false, failure: "projects.json is not valid json" });

    expect(screen.getByText(/projects\.json is not valid json/)).toBeDefined();
  });

  it("gives the ephemeral project no actions at all", () => {
    // Не выключенных, а отсутствующих: выключенная кнопка обещает, что когда-нибудь она сработает,
    // а эфемерный проект не переименовывается никогда (docs/sessions-and-projects.md).
    show(withProjects([work, project("a")]));

    expect(within(rowOf("Работа без проекта")).queryByRole("button")).toBeNull();
    expect(within(rowOf("a")).getByRole("button", { name: /Действия/ })).toBeDefined();
  });

  it("marks a folder that is not there", () => {
    show(withProjects([project("a", { availability: "missing" }), project("b")]));

    expect(within(rowOf("a")).getByText("Папка недоступна")).toBeDefined();
    expect(within(rowOf("b")).queryByText("Папка недоступна")).toBeNull();
  });

  it("archives and restores through one call with the whole record", () => {
    const gone = project("gone", { archived: true });
    const { onUpdate } = show(withProjects([project("a")], [gone]));

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "В архив" }));

    expect(onUpdate).toHaveBeenCalledWith("a", { name: "a", archived: true });

    openActions("gone");
    fireEvent.click(screen.getByRole("menuitem", { name: "Вернуть из архива" }));

    expect(onUpdate).toHaveBeenLastCalledWith("gone", { name: "gone", archived: false });
  });

  it("asks before deleting and says the sessions are not counted yet", () => {
    // Подтверждение обязано называть, сколько сессий пропадёт, а не спрашивать «вы уверены»
    // (docs/sessions-and-projects.md). Считалки ещё нет — и текст говорит об этом прямо.
    const { onRemove } = show(withProjects([project("a")]));

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/Сессий у проекта нет/)).toBeDefined();
    expect(screen.getByText(/Папку на диске платформа не трогает/)).toBeDefined();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить безвозвратно" }),
    );

    expect(onRemove).toHaveBeenCalledWith("a");
  });

  it("counts the sessions once there are any", () => {
    show(withProjects([project("a", { sessionCount: 3 })]));

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));

    expect(screen.getByText("Вместе с проектом пропадёт 3 сессии.")).toBeDefined();
  });

  it("renames through the confirmation dialog, not in place", () => {
    const { onUpdate } = show(withProjects([project("a", { archived: false })]));

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));

    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Другое" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Переименовать" }));

    expect(onUpdate).toHaveBeenCalledWith("a", { name: "Другое", archived: false });
  });

  it("marks the project that took the folder, not just the text of the refusal", () => {
    const taken = project("taken", { name: "Первый" });
    const state = applyConflict(withProjects([taken, project("free")]), {
      error: "the folder already belongs to a project",
      project: taken,
    });

    show(state);

    expect(within(rowOf("Первый")).getByText("занял папку")).toBeDefined();
    expect(within(rowOf("free")).queryByText("занял папку")).toBeNull();
    expect(screen.getByText(/принадлежит проекту/)).toBeDefined();
  });

  it("keeps what was typed when the creation is refused", async () => {
    // После отказа человек правит путь, а не набирает его заново.
    const onCreate = vi.fn().mockResolvedValue(false);

    show(withProjects([]), { onCreate });

    const folder = screen.getByLabelText("Папка") as HTMLInputElement;
    const name = screen.getByLabelText("Имя") as HTMLInputElement;

    fireEvent.change(folder, { target: { value: "  ~/code/platform  " } });
    fireEvent.change(name, { target: { value: "Платформа" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать проект" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());

    // Пробелы по краям снимаются до отправки: опечатка ввода не должна становиться частью пути.
    expect(onCreate).toHaveBeenCalledWith({ folder: "~/code/platform", name: "Платформа" });
    expect(folder.value).toBe("  ~/code/platform  ");
  });

  it("clears the form once the project is created", async () => {
    const { onCreate } = show(withProjects([]));

    fireEvent.change(screen.getByLabelText("Папка"), { target: { value: "/code/platform" } });
    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Платформа" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать проект" }));

    // Ждать надо очистки, а не вызова: поля чистит `then`, который к моменту вызова ещё не дошёл.
    await waitFor(() =>
      expect((screen.getByLabelText("Папка") as HTMLInputElement).value).toBe(""),
    );
    expect(onCreate).toHaveBeenCalled();
  });

  it("keeps the create button locked until both fields say something", () => {
    show(withProjects([]));

    const create = (): HTMLButtonElement =>
      screen.getByRole("button", { name: "Создать проект" }) as HTMLButtonElement;

    expect(create().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Папка"), { target: { value: "/code" } });
    expect(create().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Имя" } });
    expect(create().disabled).toBe(false);
  });

  it("puts the archived projects behind a disclosure, out of the working list", () => {
    show(withProjects([project("a")], [project("gone", { archived: true })]));

    expect(screen.getByText("Архив: 1 проект")).toBeDefined();
  });
});
