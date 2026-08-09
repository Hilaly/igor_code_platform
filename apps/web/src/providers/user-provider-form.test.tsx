// @vitest-environment jsdom

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserProviderForm } from "./user-provider-form.tsx";

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

describe("UserProviderForm", () => {
  it("uses settings rows instead of nested panels for every provider property", () => {
    render(
      <UserProviderForm
        mode="create"
        onBack={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
        translator={translator}
      />,
    );

    for (const name of ["Идентификатор", "Название", "Базовый URL API"]) {
      expect(screen.getByRole("textbox", { name }).closest('[role="group"]')).not.toBeNull();
    }
    expect(
      screen.getByRole("combobox", { name: "Формат запросов" }).closest('[role="group"]'),
    ).not.toBeNull();
    const expectTooltipToggles = (name: string, count: number) => {
      const toggles = screen.getAllByRole("checkbox", { name });
      expect(toggles).toHaveLength(count);
      expect(screen.getAllByRole("tooltip", { name })).toHaveLength(count);
      for (const toggle of toggles) {
        expect(
          toggle.closest("label")?.querySelector('[class*="visuallyHidden"]')?.textContent,
        ).toBe(name);
      }
    };
    for (const name of [
      "Загружать модели автоматически",
      "Модели поддерживают reasoning",
      "Модели принимают изображения",
    ]) {
      expectTooltipToggles(name, 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Добавить ручную модель/ }));
    expect(screen.getByRole("region", { name: "Модели вручную" })).toBeDefined();
    expectTooltipToggles("Модели поддерживают reasoning", 2);
    expectTooltipToggles("Модели принимают изображения", 2);
    expect(document.querySelector("[class*='panel']")).toBeNull();
  });

  it("creates a persistent provider with protocol defaults and manual models", async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <UserProviderForm
        mode="create"
        onBack={vi.fn()}
        onSubmit={onSubmit}
        translator={translator}
      />,
    );

    fireEvent.change(screen.getByLabelText("Идентификатор"), {
      target: { value: "acme" },
    });
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Acme AI" },
    });
    fireEvent.change(screen.getByLabelText("Базовый URL API"), {
      target: { value: "https://api.acme.example/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Добавить ручную модель/ }));
    fireEvent.change(screen.getByLabelText("Идентификатор модели"), {
      target: { value: "acme-large" },
    });
    fireEvent.change(screen.getByLabelText("Название модели"), {
      target: { value: "Acme Large" },
    });
    const contexts = screen.getAllByLabelText("Контекстное окно");
    fireEvent.change(contexts[0]!, { target: { value: "256000" } });
    const reasoning = screen.getAllByLabelText("Модели поддерживают reasoning");
    fireEvent.click(reasoning[0]!);

    fireEvent.click(screen.getByRole("button", { name: "Сохранить провайдер" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "acme",
        name: "Acme AI",
        baseUrl: "https://api.acme.example/v1",
        api: "openai-responses",
        modelsEndpoint: { kind: "default" },
        manualModels: [
          expect.objectContaining({
            id: "acme-large",
            name: "Acme Large",
            contextWindow: 256_000,
            reasoning: true,
          }),
        ],
      }),
    );
  });

  it("does not submit malformed model overrides", () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <UserProviderForm
        mode="create"
        onBack={vi.fn()}
        onSubmit={onSubmit}
        translator={translator}
      />,
    );

    fireEvent.change(screen.getByLabelText("Переопределения моделей (JSON)"), {
      target: { value: "{" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить провайдер" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Переопределения моделей должны быть корректным JSON.")).toBeDefined();
  });
});
