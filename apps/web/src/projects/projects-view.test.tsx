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
  const onOpen = vi.fn();

  render(
    <ProjectsView
      state={state}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onDismissComplaints={onDismissComplaints}
      translator={translator}
      {...overrides}
      onOpen={onOpen}
    />,
  );

  return { onCreate, onUpdate, onRemove, onDismissComplaints, onOpen };
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

const openNewProject = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "+ Новый проект" }));
};

describe("ProjectsView", () => {
  it("leaves the section heading to settings when embedded", () => {
    show(withProjects([]), { headingLevel: 2 });

    expect(screen.queryByRole("heading", { name: "Проекты" })).toBeNull();
  });

  it("exposes active projects as one named list with separate row actions", () => {
    show(withProjects([project("alpha", { name: "Alpha" }), project("beta", { name: "Beta" })]));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("toolbar", { name: "Проекты" })).toBeDefined();

    const projects = screen.getByRole("list", { name: "Проекты" });
    const rows = within(projects).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(
      projects.parentElement?.closest("section:not([aria-label]):not([aria-labelledby])"),
    ).toBeNull();

    for (const row of rows) {
      const actions = within(row).getByRole("button", { name: /Действия/ });
      const selectable = within(row)
        .getAllByRole("button")
        .find((button) => button !== actions);

      expect(selectable).toBeDefined();
      expect(selectable?.parentElement).toBe(row);
      expect(actions.closest("li")).toBe(row);
      expect(selectable?.contains(actions)).toBe(false);
    }
  });

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

    expect(within(rowOf("Быстрая работа")).queryByRole("button", { name: /Действия/ })).toBeNull();
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
    const { onRemove, onOpen } = show(withProjects([project("a")]));

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));

    expect(onRemove).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/Сессий у проекта нет/)).toBeDefined();
    expect(screen.getByText(/Папку на диске платформа не трогает/)).toBeDefined();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Отмена" }));

    expect(onRemove).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить безвозвратно" }),
    );

    expect(onRemove).toHaveBeenCalledWith("a");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("counts the sessions once there are any", () => {
    show(withProjects([project("a", { sessionCount: 3 })]));

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));

    expect(screen.getByText("Вместе с проектом пропадёт 3 сессии.")).toBeDefined();
  });

  it("renames through the confirmation dialog, not in place", () => {
    const { onUpdate, onOpen } = show(withProjects([project("a", { archived: false })]));

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));

    expect(onOpen).not.toHaveBeenCalled();

    let dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText("Имя");

    fireEvent.click(name);
    fireEvent.change(name, { target: { value: "Отменённое имя" } });

    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();

    openActions("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));
    dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Другое" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Переименовать" }));

    expect(onUpdate).toHaveBeenCalledWith("a", { name: "Другое", archived: false });
    expect(onOpen).not.toHaveBeenCalled();
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
    openNewProject();

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
    openNewProject();

    fireEvent.change(screen.getByLabelText("Папка"), { target: { value: "/code/platform" } });
    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Платформа" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать проект" }));

    // После успеха форма сворачивается: следующий проект снова начинается с явного действия.
    await waitFor(() => expect(screen.queryByLabelText("Папка")).toBeNull());
    expect(onCreate).toHaveBeenCalled();
  });

  it("puts the folder picked in the browser into the folder field", async () => {
    // Пикер зовёт демон за листингом; в тесте ответы подменены. Выбранный путь уезжает в то же поле,
    // что и ручной ввод, — отдельного источника правды для папки нет.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      // Относительный путь запроса разбираем как строку: в jsdom у `new Request` нет базы, и
      // `URL` бросается на about:blank. Параметр `path` кодирован, поэтому декодируем его.
      const url = typeof input === "string" ? input : input.toString();
      const match = /[?&]path=([^&]+)/.exec(url);
      const path = match?.[1] === undefined ? "" : decodeURIComponent(match[1]);
      const body =
        path === "/"
          ? { path: "/", entries: [{ name: "code", kind: "directory" }] }
          : { path, entries: [] };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    try {
      show(withProjects([]));
      openNewProject();

      fireEvent.click(screen.getByRole("button", { name: "Обзор…" }));

      // Листинг корня приехал — папка `code` видна.
      await waitFor(() => expect(screen.getByRole("button", { name: "code" })).toBeDefined());

      // Один клик выделяет, «Выбрать» подтверждает — путь лежит в поле папки.
      fireEvent.click(screen.getByRole("button", { name: "code" }));
      fireEvent.click(screen.getByRole("button", { name: "Выбрать" }));

      expect((screen.getByLabelText("Папка") as HTMLInputElement).value).toBe("/code");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("shows only directories in the project folder picker", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          path: "/",
          entries: [
            { name: "code", kind: "directory" },
            { name: "readme.md", kind: "file" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      show(withProjects([]));
      openNewProject();
      fireEvent.click(screen.getByRole("button", { name: "Обзор…" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "code" })).toBeDefined());

      expect(screen.queryByRole("button", { name: "readme.md" })).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("drops the previous directory entries while the next listing is loading", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = new URL(url, "http://localhost").searchParams.get("path");

      if (path === "/") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ path: "/", entries: [{ name: "code", kind: "directory" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }

      // Второй листинг намеренно не приходит: проверяем промежуточный кадр сразу после перехода.
      return new Promise<Response>(() => undefined);
    });

    try {
      show(withProjects([]));
      openNewProject();
      fireEvent.click(screen.getByRole("button", { name: "Обзор…" }));
      const code = await screen.findByRole("button", { name: "code" });

      fireEvent.doubleClick(code);

      expect(screen.getByText("/code")).toBeDefined();
      expect(screen.queryByRole("button", { name: "code" })).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps the create button locked until both fields say something", () => {
    show(withProjects([]));
    openNewProject();

    const create = (): HTMLButtonElement =>
      screen.getByRole("button", { name: "Создать проект" }) as HTMLButtonElement;

    expect(create().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Папка"), { target: { value: "/code" } });
    expect(create().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Имя" } });
    expect(create().disabled).toBe(false);
  });

  it("filters projects by name and folder", () => {
    show(
      withProjects([
        project("alpha", { name: "Alpha", folder: "/code/alpha" }),
        project("beta", { name: "Beta", folder: "/code/beta" }),
      ]),
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск проектов" }), {
      target: { value: "beta" },
    });

    expect(screen.getByText("Beta")).toBeDefined();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("opens a project when its card is selected", () => {
    const { onOpen } = show(withProjects([project("alpha", { name: "Alpha" })]));

    fireEvent.click(within(rowOf("Alpha")).getAllByRole("button")[0]!);

    expect(onOpen).toHaveBeenCalledWith("alpha");
  });

  it("truncates a long folder path but keeps the full one in the tooltip", () => {
    // Длинный путь режется до хвоста в самом `<code>`, а полный живёт в тултипе — иначе карточка
    // растягивалась или путь ломался посимвольно. Тултип всегда в DOM (CSS-only, показывается
    // наведением), поэтому полный путь там и проверяется.
    const deep = "/Users/me/repos/sovereign_platform_node/apps/daemon";
    show(withProjects([project("alpha", { name: "Alpha", folder: deep })]));

    const row = rowOf("Alpha");

    // Видимый путь — сокращённый: средние компоненты свернуты в `…`.
    expect(within(row).getByText("/…/sovereign_platform_node/apps/daemon").tagName).toBe("CODE");
    // Полный путь — в тултипе, привязанном к строке.
    const tooltip = within(row).getByRole("tooltip", { name: deep });
    const select = within(row).getAllByRole("button")[0]!;
    expect(select.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("shows a short folder path whole, with the same path repeated in the tooltip", () => {
    show(withProjects([project("alpha", { name: "Alpha", folder: "/code/alpha" })]));

    const row = rowOf("Alpha");

    // Короткий путь показывается целиком как видимый `<code>`, и он же повторяется в тултипе —
    // поведение едино для длинных и коротких путей, особый случай тут не нужен.
    expect(within(row).getByRole("tooltip", { name: "/code/alpha" })).toBeDefined();
    const code = row.querySelector("code");
    expect(code?.textContent).toBe("/code/alpha");
  });

  it("puts the archived projects behind a disclosure, out of the working list", () => {
    show(withProjects([project("a")], [project("gone", { archived: true })]));

    const summary = screen.getByText("Архив: 1 проект");
    const disclosure = summary.closest("details");

    expect(disclosure).not.toBeNull();
    expect(within(screen.getByRole("list", { name: "Проекты" })).queryByText("gone")).toBeNull();

    const archived = within(disclosure as HTMLElement).getByRole("list", {
      name: "Архив: 1 проект",
    });

    expect(within(archived).getAllByRole("listitem")).toHaveLength(1);
    expect(within(archived).getByText("gone")).toBeDefined();
    expect(
      archived.parentElement?.closest("section:not([aria-label]):not([aria-labelledby])"),
    ).toBeNull();
  });
});
