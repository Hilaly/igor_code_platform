// @vitest-environment jsdom

/**
 * Экран создания сессии на настоящем DOM. Проверяется двойная выборка модели через ModelPicker
 * (провайдер → модель с ленивой подгрузкой), предзаполнение модели и уровня размышлений из агента,
 * модель без размышлений, отказ демона (экран остаётся), и отправка первого сообщения вместе
 * с созданием одним действием человека, но двумя запросами — без изменения контракта `SessionDraft`.
 *
 * Переводчик здесь бросает на любой ненайденный ключ.
 */

import type { AgentSummary, ModelSummary, Project, ProviderSummary } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewSessionView, type NewSessionViewProps } from "./new-session-view.tsx";
import type { ModelsEntry } from "./state.ts";

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

const project: Project = {
  id: "b7Kq",
  name: "Платформа",
  folder: "/code/platform",
  folderKey: "/code/platform",
  archived: false,
  availability: "available",
  sessionCount: 0,
  ephemeral: false,
  createdAt: "2026-07-29T00:00:00.000Z",
};

const baseAgent: AgentSummary = {
  id: "base-agent.agent",
  title: "Базовый агент",
  ownership: "plugin",
  pluginKey: "builtin:base-agent",
  source: "builtin",
  skills: { include: [], exclude: [] },
};

const provider: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [],
  auth: { kind: "configured", type: "api_key" },
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 1,
};

const model = (overrides: Partial<ModelSummary> = {}): ModelSummary => ({
  id: "claude-opus-4-5",
  name: "Claude Opus 4.5",
  providerId: "anthropic",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: true,
  input: ["text"],
  cost: { input: 3, output: 15 },
  ...overrides,
});

const ready: Record<string, ModelsEntry> = {
  anthropic: { kind: "ready", models: [model()] },
};

const show = (overrides: Partial<NewSessionViewProps> = {}) => {
  const onCreate: NewSessionViewProps["onCreate"] = vi.fn(() =>
    Promise.resolve({ sessionId: "0199" }),
  );
  const onPickProvider = vi.fn();
  const onSubmit = vi.fn();
  const onNavigate = vi.fn();
  const onPrepareDraft = vi.fn();
  const onSelectProject = vi.fn();
  const props: NewSessionViewProps = {
    projects: [project],
    projectAgents: { projectId: "b7Kq", agents: [baseAgent], loading: false },
    providers: [provider],
    models: {},
    onPrepareDraft,
    onSelectProject,
    onPickProvider,
    onCreate,
    onSubmit,
    onNavigate,
    translator,
    ...overrides,
  };

  return {
    ...render(<NewSessionView {...props} />),
    onCreate,
    onPickProvider,
    onSubmit,
    onNavigate,
    onSelectProject,
  };
};

/** Раскрыть группу провайдера в ModelPicker: клик по триггеру, затем по шапке группы. */
const expandProvider = (label: string, group: string): void => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("treeitem", { name: group }).querySelector("div")!);
};

const pick = (label: string, option: string): void => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

describe("the screen that creates a session", () => {
  it("exposes one named form region with its page heading", () => {
    show();

    const region = screen.getByRole("region", { name: "Новая сессия" });
    expect(within(region).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(region.querySelector("form")).not.toBeNull();
  });

  it("uses a valid header composition for the page title and hint", () => {
    show();

    const region = screen.getByRole("region", { name: "Новая сессия" });
    const header = region.querySelector("header");

    expect(region.querySelector("hgroup")).toBeNull();
    expect(header).not.toBeNull();
    expect(within(header!).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      within(header!).getByText("Выбери проект, агента и модель — и сразу напиши, с чего начать."),
    ).not.toBeNull();
  });

  it("prepares the draft on mount", () => {
    const onPrepareDraft = vi.fn();
    show({ onPrepareDraft });

    // Mount сам зовёт onPrepareDraft — данные для селекторов проекта и провайдера.
    expect(onPrepareDraft).toHaveBeenCalledTimes(1);
  });

  it("refuses to create until project and agent are chosen", () => {
    show();

    expect(screen.getByRole("button", { name: "Создать" }).hasAttribute("disabled")).toBe(true);
  });

  it("disables agent selection until a project is chosen", () => {
    const view = show();

    expect(screen.getByRole("combobox", { name: "Агент" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(view.onSelectProject).not.toHaveBeenCalled();

    pick("Проект", "Платформа — /code/platform");

    expect(view.onSelectProject).toHaveBeenCalledWith("b7Kq");
  });

  it("shows loading, failure, and project-specific empty agent states", () => {
    const view = show({ projectAgents: { projectId: "b7Kq", loading: true } });
    pick("Проект", "Платформа — /code/platform");
    expect(screen.getByText(/агенты проекта загружаются/i)).not.toBeNull();

    view.rerender(
      <NewSessionView
        {...({
          projects: [project],
          projectAgents: { projectId: "b7Kq", loading: false, failure: "catalogue unavailable" },
          providers: [provider],
          models: {},
          onPrepareDraft: vi.fn(),
          onSelectProject: vi.fn(),
          onPickProvider: vi.fn(),
          onCreate: vi.fn(),
          onSubmit: vi.fn(),
          onNavigate: vi.fn(),
          translator,
        } satisfies NewSessionViewProps)}
      />,
    );
    expect(screen.getByText(/catalogue unavailable/)).not.toBeNull();

    view.rerender(
      <NewSessionView
        {...({
          projects: [project],
          projectAgents: { projectId: "b7Kq", agents: [], loading: false },
          providers: [provider],
          models: {},
          onPrepareDraft: vi.fn(),
          onSelectProject: vi.fn(),
          onPickProvider: vi.fn(),
          onCreate: vi.fn(),
          onSubmit: vi.fn(),
          onNavigate: vi.fn(),
          translator,
        } satisfies NewSessionViewProps)}
      />,
    );
    expect(screen.getByText(/в проекте «Платформа» нет доступных агентов/i)).not.toBeNull();
  });

  it("preselects a project from its detail page and requests its agents immediately", () => {
    const view = show({ initialProjectId: "b7Kq" });

    expect(screen.getByRole("combobox", { name: "Проект" }).textContent).toContain("Платформа");
    expect(view.onSelectProject).toHaveBeenCalledWith("b7Kq");
  });

  it("resets the agent, model, and thinking defaults before loading another project", () => {
    const agentWithDefaults: AgentSummary = {
      ...baseAgent,
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    };
    const view = show({
      projectAgents: { projectId: "b7Kq", agents: [agentWithDefaults], loading: false },
      models: ready,
    });
    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");

    const other = { ...project, id: "p2", name: "Другой" };
    view.rerender(
      <NewSessionView
        projects={[project, other]}
        projectAgents={{ projectId: "b7Kq", agents: [agentWithDefaults], loading: false }}
        providers={[provider]}
        models={ready}
        onPrepareDraft={vi.fn()}
        onSelectProject={view.onSelectProject}
        onPickProvider={view.onPickProvider}
        onCreate={view.onCreate}
        onSubmit={view.onSubmit}
        onNavigate={view.onNavigate}
        translator={translator}
      />,
    );
    pick("Проект", "Другой — /code/platform");

    expect(screen.getByRole("combobox", { name: "Агент" }).textContent).toContain("Выберите");
    expect(screen.getByRole("combobox", { name: "Модель" }).textContent).toContain("Выберите");
    expect(screen.getByRole("combobox", { name: "Уровень размышлений" }).textContent).toContain(
      "Средний",
    );
    expect(view.onSelectProject).toHaveBeenLastCalledWith("p2");
  });

  it("clears a selected agent and its defaults when a refreshed project catalogue removes it", () => {
    const agentWithDefaults: AgentSummary = {
      ...baseAgent,
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    };
    const view = show({
      projectAgents: { projectId: "b7Kq", agents: [agentWithDefaults], loading: false },
      models: ready,
    });
    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");

    view.rerender(
      <NewSessionView
        projects={[project]}
        projectAgents={{ projectId: "b7Kq", agents: [], loading: false }}
        providers={[provider]}
        models={ready}
        onPrepareDraft={vi.fn()}
        onSelectProject={view.onSelectProject}
        onPickProvider={view.onPickProvider}
        onCreate={view.onCreate}
        onSubmit={view.onSubmit}
        onNavigate={view.onNavigate}
        translator={translator}
      />,
    );

    expect(screen.getByRole("button", { name: "Создать" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "Модель" }).textContent).toContain("Выберите");
    expect(screen.getByRole("combobox", { name: "Уровень размышлений" }).textContent).toContain(
      "Средний",
    );
  });

  it("clears the project and every dependent field when the selectable projects drop it", async () => {
    const agentWithDefaults: AgentSummary = {
      ...baseAgent,
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    };
    const view = show({
      projectAgents: { projectId: "b7Kq", agents: [agentWithDefaults], loading: false },
      models: ready,
    });
    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");

    view.rerender(
      <NewSessionView
        projects={[]}
        projectAgents={{ projectId: "b7Kq", agents: [agentWithDefaults], loading: false }}
        providers={[provider]}
        models={ready}
        onPrepareDraft={vi.fn()}
        onSelectProject={view.onSelectProject}
        onPickProvider={view.onPickProvider}
        onCreate={view.onCreate}
        onSubmit={view.onSubmit}
        onNavigate={view.onNavigate}
        translator={translator}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Проект" }).textContent).toContain("Выберите"),
    );
    expect(screen.getByRole("combobox", { name: "Агент" }).textContent).toContain("Выберите");
    expect(screen.getByRole("combobox", { name: "Модель" }).textContent).toContain("Выберите");
    expect(screen.getByRole("combobox", { name: "Уровень размышлений" }).textContent).toContain(
      "Средний",
    );
    expect(screen.getByRole("button", { name: "Создать" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(view.onCreate).not.toHaveBeenCalled();
    expect(view.onSelectProject).toHaveBeenLastCalledWith("");
  });

  it("asks for the models of a provider when its group is expanded", () => {
    const view = show();

    expect(view.onPickProvider).not.toHaveBeenCalled();

    expandProvider("Модель", "Anthropic");

    expect(view.onPickProvider).toHaveBeenCalledWith("anthropic");
  });

  it("sends the four fields of the draft, with the model as one reference, and navigates", async () => {
    const view = show({ models: ready });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");
    expandProvider("Модель", "Anthropic");
    fireEvent.click(screen.getByRole("treeitem", { name: /claude-opus-4-5/ }));

    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onCreate).toHaveBeenCalledTimes(1));
    expect(view.onCreate).toHaveBeenCalledWith({
      projectId: "b7Kq",
      agentId: "base-agent.agent",
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "medium",
    });
    expect(view.onNavigate).toHaveBeenCalledWith("0199");
  });

  it("prefills the model and thinking level from the chosen agent", async () => {
    const agentWithDefaults: AgentSummary = {
      ...baseAgent,
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    };
    const view = show({
      projectAgents: { projectId: "b7Kq", agents: [agentWithDefaults], loading: false },
      models: ready,
    });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");

    // Модель из агента предзаполнена, и провайдер её уже опрошен.
    expect(view.onPickProvider).toHaveBeenCalledWith("anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onCreate).toHaveBeenCalledTimes(1));
    expect(view.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-opus-4-5", thinkingLevel: "high" }),
    );
  });

  it("clears the previous agent defaults when the next agent has none", async () => {
    const agentWithDefaults: AgentSummary = {
      ...baseAgent,
      id: "agent-with-defaults.agent",
      title: "Агент с умолчаниями",
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    };
    const agentWithoutDefaults: AgentSummary = {
      ...baseAgent,
      id: "agent-without-defaults.agent",
      title: "Агент без умолчаний",
    };
    const view = show({
      projectAgents: {
        projectId: "b7Kq",
        agents: [agentWithDefaults, agentWithoutDefaults],
        loading: false,
      },
      models: ready,
    });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Агент с умолчаниями");
    pick("Агент", "Агент без умолчаний");
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onCreate).toHaveBeenCalledTimes(1));
    expect(view.onCreate).toHaveBeenCalledWith({
      projectId: "b7Kq",
      agentId: "agent-without-defaults.agent",
      thinkingLevel: "medium",
    });
  });

  it("turns the thinking level off for a model that has no reasoning", async () => {
    const view = show({
      models: { anthropic: { kind: "ready", models: [model({ reasoning: false })] } },
    });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");
    expandProvider("Модель", "Anthropic");
    fireEvent.click(screen.getByRole("treeitem", { name: /claude-opus-4-5/ }));

    expect(
      screen.getByRole("combobox", { name: "Уровень размышлений" }).getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onCreate).toHaveBeenCalledTimes(1));
    expect(view.onCreate).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: "off" }));
  });

  it("stays and says why when the daemon refused", async () => {
    const onCreate = vi.fn(() => Promise.resolve({ reason: "the project is archived" }));
    show({ models: ready, onCreate });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");
    expandProvider("Модель", "Anthropic");
    fireEvent.click(screen.getByRole("treeitem", { name: /claude-opus-4-5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(screen.getByText(/the project is archived/)).not.toBeNull());
    expect(screen.getByRole("button", { name: "Создать" })).not.toBeNull();
  });

  it("sends the first message as a turn after the session was created", async () => {
    const view = show({ models: ready });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");
    expandProvider("Модель", "Anthropic");
    fireEvent.click(screen.getByRole("treeitem", { name: /claude-opus-4-5/ }));

    const composer = screen.getByRole("textbox", { name: "Первое сообщение" });
    fireEvent.change(composer, { target: { value: "привет, разбери баг" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onNavigate).toHaveBeenCalledWith("0199"));
    // Текст уезжает турном уже в созданную сессию — отдельным запросом, не полем черновика.
    expect(view.onSubmit).toHaveBeenCalledWith("0199", "привет, разбери баг");
  });

  it("creates a session without a turn when the first message is empty", async () => {
    const view = show({ models: ready });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");

    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onNavigate).toHaveBeenCalledWith("0199"));
    expect(view.onSubmit).not.toHaveBeenCalled();
  });

  it("explains an empty platform without pretending that a global agent list exists", () => {
    show({ projects: [], projectAgents: { loading: false }, providers: [] });

    expect(screen.getByText(/сначала заведи проект/)).not.toBeNull();
    expect(screen.getByText(/Сначала выбери проект/)).not.toBeNull();
    expect(screen.getByText(/Модели нужен кред/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Создать" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the model failure reason inside the expanded group", () => {
    show({
      models: { anthropic: { kind: "failed", reason: "the catalogue is broken" } },
    });

    expandProvider("Модель", "Anthropic");

    expect(screen.getByText(/the catalogue is broken/)).not.toBeNull();
  });
});
