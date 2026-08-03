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
    fireEvent.change(screen.getByLabelText("Модели вручную"), {
      target: { value: "acme-large\nacme-fast" },
    });

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
          expect.objectContaining({ id: "acme-large", contextWindow: 128_000 }),
          expect.objectContaining({ id: "acme-fast", contextWindow: 128_000 }),
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
