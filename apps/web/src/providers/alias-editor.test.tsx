// @vitest-environment jsdom

/**
 * Редактор алиасов на настоящем DOM: порядок кандидатов, неизменный идентификатор готового алиаса и
 * отказ править то, что не читается, — всё это видно только в разметке.
 */
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AliasEditor } from "./alias-editor.tsx";

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
    onSave: vi.fn(async () => undefined),
    onRemove: vi.fn(async () => undefined),
  };

  render(
    <AliasEditor
      aliases={aliases}
      {...(problem === undefined ? {} : { problem })}
      {...handlers}
      translator={translator}
    />,
  );

  return handlers;
}

describe("the alias editor", () => {
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

  it("saves a new alias with the models that were typed", () => {
    const { onSave } = show([]);

    fireEvent.click(screen.getByRole("button", { name: "Новый алиас" }));
    fireEvent.change(screen.getByLabelText("Идентификатор"), { target: { value: "opus-5" } });
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Opus 5" } });
    fireEvent.change(screen.getByLabelText("Модель 1"), {
      target: { value: "anthropic/claude-opus-4-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить модель" }));
    fireEvent.change(screen.getByLabelText("Модель 2"), {
      target: { value: "openai/gpt-5.6-sol" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить алиас" }));

    expect(onSave).toHaveBeenCalledWith(alias, false);
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
