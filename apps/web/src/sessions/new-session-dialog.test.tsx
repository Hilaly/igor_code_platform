// @vitest-environment jsdom

/**
 * Диалог создания сессии на настоящем DOM. Проверяется каскад провайдер → модель (все модели сразу
 * не спрашиваются: их больше тысячи), запрет на создание черновика без обязательного поля, отказ
 * демона, после которого диалог обязан остаться открытым, и модель без размышлений — у неё уровень
 * принудительно выключен.
 *
 * Переводчик здесь бросает на любой ненайденный ключ.
 */

import type { AgentSummary, ModelSummary, Project, ProviderSummary } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewSessionDialog, type NewSessionDialogProps } from "./new-session-dialog.tsx";
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

const agent: AgentSummary = {
  id: "base-agent.agent",
  title: "Базовый агент",
  pluginKey: "builtin:base-agent",
  source: "builtin",
  skills: [],
};

const provider: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [],
  auth: { kind: "configured", type: "api_key" },
  dynamic: false,
  custom: false,
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

const show = (overrides: Partial<NewSessionDialogProps> = {}) => {
  const onCreate: NewSessionDialogProps["onCreate"] = vi.fn(() => Promise.resolve(undefined));
  const onPickProvider = vi.fn();
  const props: NewSessionDialogProps = {
    open: true,
    projects: [project],
    agents: [agent],
    providers: [provider],
    models: {},
    onPickProvider,
    onCreate,
    onClose: vi.fn(),
    translator,
    ...overrides,
  };

  return { ...render(<NewSessionDialog {...props} />), onCreate, onPickProvider, props };
};

const pick = (label: string, option: string): void => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const ready: Record<string, ModelsEntry> = {
  anthropic: { kind: "ready", models: [model()] },
};

describe("the dialog that creates a session", () => {
  it("refuses to create until every field is answered", () => {
    show();

    expect(screen.getByRole("button", { name: "Создать" }).hasAttribute("disabled")).toBe(true);
  });

  it("asks for the models of the provider that was picked, and only of it", () => {
    // Моделей на все провайдеры больше тысячи: спрашиваются они по одному провайдеру.
    const view = show();

    expect(view.onPickProvider).not.toHaveBeenCalled();

    pick("Провайдер", "Anthropic");

    expect(view.onPickProvider).toHaveBeenCalledWith("anthropic");
  });

  it("keeps the model field shut until its list has arrived", () => {
    show({ models: { anthropic: { kind: "loading" } } });

    pick("Провайдер", "Anthropic");

    expect(screen.getByRole("combobox", { name: "Модель" }).hasAttribute("disabled")).toBe(true);
  });

  it("sends the four fields of the draft, with the model as one reference", async () => {
    const view = show({ models: ready });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");
    pick("Провайдер", "Anthropic");
    pick("Модель", "Claude Opus 4.5");

    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onCreate).toHaveBeenCalledTimes(1));
    expect(view.onCreate).toHaveBeenCalledWith({
      projectId: "b7Kq",
      agentId: "base-agent.agent",
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "medium",
    });
  });

  it("turns the thinking level off for a model that has no reasoning", async () => {
    // Уровень, который модель не примет, отправлять нельзя: демон откажет, а причина будет неочевидна.
    const view = show({
      models: { anthropic: { kind: "ready", models: [model({ reasoning: false })] } },
    });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");
    pick("Провайдер", "Anthropic");
    pick("Модель", "Claude Opus 4.5");

    expect(
      screen.getByRole("combobox", { name: "Уровень размышлений" }).getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(view.onCreate).toHaveBeenCalledTimes(1));
    expect(view.onCreate).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: "off" }));
  });

  it("stays open and says why when the daemon refused", async () => {
    const onCreate = vi.fn(() => Promise.resolve("the project is archived"));
    show({ models: ready, onCreate });

    pick("Проект", "Платформа — /code/platform");
    pick("Агент", "Базовый агент");
    pick("Провайдер", "Anthropic");
    pick("Модель", "Claude Opus 4.5");
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(screen.getByText(/the project is archived/)).not.toBeNull());
    expect(screen.getByRole("button", { name: "Создать" })).not.toBeNull();
  });

  it("explains an empty platform instead of showing three empty lists", () => {
    show({ projects: [], agents: [], providers: [] });

    expect(screen.getByText(/сначала заведи проект/)).not.toBeNull();
    expect(screen.getByText(/Агента приносит плагин/)).not.toBeNull();
    expect(screen.getByText(/Модели нужен кред/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Создать" }).hasAttribute("disabled")).toBe(true);
  });

  it("says the models could not be read instead of showing an empty list", () => {
    show({ models: { anthropic: { kind: "failed", reason: "the catalogue is broken" } } });

    pick("Провайдер", "Anthropic");

    expect(screen.getByText(/the catalogue is broken/)).not.toBeNull();
  });
});
