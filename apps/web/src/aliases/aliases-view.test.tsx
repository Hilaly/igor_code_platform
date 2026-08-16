// @vitest-environment jsdom

/**
 * Вью алиасов на настоящем DOM: выбор кандидата пикером, порядок кандидатов, неизменный
 * идентификатор готового алиаса и отказ править то, что не читается, — всё это видно только в
 * разметке.
 */
import type { ModelSummary, ProviderSummary } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AliasesView } from "./aliases-view.tsx";
import type { ProviderModelsEntry } from "../providers/state.ts";

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

const provider = (id: string, name: string, origin: ProviderSummary["origin"] = "builtin") =>
  ({
    id,
    name,
    logins: [],
    auth: { kind: "configured", type: "api_key" },
    keys: [],
    dynamic: false,
    custom: false,
    origin,
    modelCount: 1,
  }) satisfies ProviderSummary;

const model = (providerId: string, id: string, name: string) =>
  ({
    id,
    name,
    providerId,
    contextWindow: 200_000,
    maxTokens: 32_000,
    reasoning: true,
    input: ["text"],
    cost: { input: 3, output: 15 },
  }) satisfies ModelSummary;

const providers = [
  provider("anthropic", "Anthropic"),
  provider("openai", "OpenAI"),
  // Алиас виден системе как провайдер, но кандидатом быть не может: цикл разорвать нечем.
  provider("alias", "Алиасы", "alias"),
];

const models: Record<string, ProviderModelsEntry> = {
  anthropic: {
    kind: "ready",
    models: [
      model("anthropic", "claude-opus-4-5", "Claude Opus 4.5"),
      model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5"),
    ],
  },
};

const alias = {
  id: "opus-5",
  name: "Opus 5",
  candidates: [
    { providerId: "anthropic", modelId: "claude-opus-4-5" },
    { providerId: "openai", modelId: "gpt-5.6-sol" },
  ],
};

function show(aliases: (typeof alias)[] | undefined, problem?: string) {
  const handlers = {
    onExpandProvider: vi.fn(),
    onSave: vi.fn(async () => undefined),
    onRemove: vi.fn(async () => undefined),
  };

  render(
    <AliasesView
      aliases={aliases}
      {...(problem === undefined ? {} : { problem })}
      providers={providers}
      models={models}
      {...handlers}
      translator={translator}
    />,
  );

  return handlers;
}

/** Раскрыть группу провайдера в пикере кандидата: заголовок группы — вложенный узел строки. */
function openGroup(candidate: string, group: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: candidate }));
  fireEvent.click(screen.getByRole("treeitem", { name: group }).querySelector("div")!);
}

describe("the aliases view", () => {
  it("shows an alias with its reference and the models behind it, in order", () => {
    show([alias]);

    expect(screen.getByText("alias/opus-5")).toBeDefined();
    expect(screen.getByText("anthropic/claude-opus-4-5")).toBeDefined();
    expect(screen.getByText("openai/gpt-5.6-sol")).toBeDefined();
  });

  it("says outright that there are no aliases yet", () => {
    show([]);

    expect(screen.getByText("Алиасов пока нет")).toBeDefined();
  });

  it("saves a new alias with the models picked out of the catalogue", () => {
    const { onSave } = show([]);

    fireEvent.click(screen.getByRole("button", { name: "Новый алиас" }));
    fireEvent.change(screen.getByLabelText("Идентификатор"), { target: { value: "opus-5" } });
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Opus 5" } });

    openGroup("Модель 1", "Anthropic");
    fireEvent.click(screen.getByRole("treeitem", { name: /claude-opus-4-5/ }));

    fireEvent.click(screen.getByRole("button", { name: "Добавить модель" }));
    openGroup("Модель 2", "Anthropic");
    fireEvent.click(screen.getByRole("treeitem", { name: /claude-sonnet-4-5/ }));

    fireEvent.click(screen.getByRole("button", { name: "Сохранить алиас" }));

    expect(onSave).toHaveBeenCalledWith(
      {
        id: "opus-5",
        name: "Opus 5",
        candidates: [
          { providerId: "anthropic", modelId: "claude-opus-4-5" },
          { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
        ],
      },
      false,
    );
  });

  it("asks a provider for its models only when its group is opened", () => {
    const { onExpandProvider } = show([]);

    fireEvent.click(screen.getByRole("button", { name: "Новый алиас" }));

    expect(onExpandProvider).not.toHaveBeenCalled();

    openGroup("Модель 1", "OpenAI");

    // Всех моделей всех провайдеров больше тысячи: спрашивается только раскрытый.
    expect(onExpandProvider).toHaveBeenCalledWith("openai");
    expect(onExpandProvider).not.toHaveBeenCalledWith("anthropic");
  });

  it("never offers another alias as a candidate", () => {
    show([alias]);

    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Модель 1" }));

    expect(
      screen.queryAllByRole("treeitem").map((item) => item.getAttribute("aria-label")),
    ).not.toContain("Алиасы");
  });

  it("does not offer a model that another candidate has already taken", () => {
    show([alias]);

    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    openGroup("Модель 2", "Anthropic");

    // Первый кандидат уже стоит на этой модели, а дважды названную разбор алиаса отклоняет.
    expect(
      screen.getByRole("treeitem", { name: /claude-opus-4-5/ }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("does not offer to save an alias that has nothing behind it", () => {
    show([]);

    fireEvent.click(screen.getByRole("button", { name: "Новый алиас" }));
    fireEvent.change(screen.getByLabelText("Идентификатор"), { target: { value: "opus-5" } });
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Opus 5" } });

    expect(screen.getByRole("button", { name: "Сохранить алиас" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("keeps the identifier of an alias that already exists", () => {
    show([alias]);

    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));

    // Идентификатор — часть ссылки на модель в сессиях: смена имени оборвала бы их молча.
    expect(screen.getByLabelText("Идентификатор")).toHaveProperty("disabled", true);
  });

  it("keeps a candidate whose provider is gone out of the catalogue", () => {
    show([alias]);

    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));

    // Модели `openai` не прочитаны вовсе, но выбранное подменять нечем: ссылка остаётся в триггере.
    expect(screen.getByRole("combobox", { name: "Модель 2" }).textContent).toContain(
      "openai/gpt-5.6-sol",
    );
  });

  it("changes the order of the models by hand", () => {
    const { onSave } = show([alias]);

    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    fireEvent.click(screen.getByRole("button", { name: "Поднять модель 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить алиас" }));

    expect(onSave).toHaveBeenCalledWith(
      { ...alias, candidates: [alias.candidates[1], alias.candidates[0]] },
      true,
    );
  });

  it("asks before deleting an alias and says what it costs", () => {
    const { onRemove } = show([alias]);

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(screen.getByText(/останутся без модели/)).toBeDefined();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить" }));

    expect(onRemove).toHaveBeenCalledWith("opus-5");
  });

  it("offers no editing over a file it could not read", () => {
    show(undefined, "model-aliases.json is not valid json");

    expect(screen.getByText("model-aliases.json is not valid json")).toBeDefined();
    expect(screen.getByRole("button", { name: "Новый алиас" })).toHaveProperty("disabled", true);
  });
});
