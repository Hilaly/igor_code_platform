// @vitest-environment jsdom

/**
 * Вью провайдеров на настоящем DOM. Проверяется то, чего не видно ни в разметке первого кадра, ни
 * глазами за один проход: что беда с кредами не прячет список, что три состояния авторизации
 * различимы (а не сведены к «есть/нет»), что способы входа показаны, но войти пока нечем, и что
 * модели спрашиваются по раскрытию строки, а не приезжают вместе со списком.
 *
 * Переводчик здесь бросает на любой ненайденный ключ: непереведённая строка в интерфейсе — не
 * «мелочь на потом», а то, ради чего диагностика вообще заведена (docs/ui-kit.md).
 */

import type { ModelSummary, ProviderSummary } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProvidersView } from "./providers-view.tsx";
import {
  applyModels,
  applyModelsFailure,
  applySnapshot,
  initialProvidersState,
  openProvider,
  type ProvidersState,
} from "./state.ts";

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

/** Имя отличается от идентификатора нарочно: в строке стоит и то и другое, как у настоящих. */
const named = (id: string): string => `${id[0]?.toUpperCase() ?? ""}${id.slice(1)}`;

const provider = (id: string, overrides: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id,
  name: named(id),
  logins: [{ type: "api_key", label: `${id} API key` }],
  auth: { kind: "unconfigured" },
  dynamic: false,
  custom: false,
  modelCount: 2,
  ...overrides,
});

const model = (id: string, overrides: Partial<ModelSummary> = {}): ModelSummary => ({
  id,
  name: id,
  providerId: "anthropic",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: true,
  input: ["text"],
  cost: { input: 3, output: 15 },
  ...overrides,
});

function show(state: ProvidersState) {
  const onOpen = vi.fn();

  render(<ProvidersView state={state} onOpen={onOpen} translator={translator} />);

  return { onOpen };
}

const withProviders = (providers: ProviderSummary[], problem?: string): ProvidersState =>
  applySnapshot(initialProvidersState, {
    providers,
    ...(problem === undefined ? {} : { problem }),
  });

/** Строка провайдера: значки и подписи ищутся внутри своей строки, а не по всей странице. */
const rowOf = (name: string): HTMLElement => {
  const label = screen.getByText(name);
  const row = label.closest("li");

  if (row === null) {
    throw new Error(`the row of ${name} was not found`);
  }

  return row;
};

describe("ProvidersView", () => {
  it("waits for the first snapshot instead of showing an empty list", () => {
    show(initialProvidersState);

    expect(screen.queryByText("Провайдеров нет вовсе")).toBeNull();
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("says why the providers could not be read", () => {
    show({ models: {}, failure: "the daemon answered 500" });

    expect(screen.getByText(/the daemon answered 500/)).toBeDefined();
  });

  it("shows the trouble with the credentials and the list all the same", () => {
    // Каталог провайдеров от файла кредов не зависит (docs/web-api.md): пустое вью чинить файл не
    // помогает, а вью с честным «сказать нечем» — помогает.
    show(
      withProviders(
        [provider("anthropic", { auth: { kind: "unknown" } })],
        "credentials.json is not valid json",
      ),
    );

    expect(screen.getByText(/credentials\.json is not valid json/)).toBeDefined();
    expect(screen.getByText("Креды не читаются")).toBeDefined();
    expect(within(rowOf("Anthropic")).getByText("Сказать нечем")).toBeDefined();
  });

  it("tells the three states of the authorisation apart", () => {
    show(
      withProviders([
        provider("anthropic", { auth: { kind: "configured", type: "oauth", source: "OAuth" } }),
        provider("openai", { auth: { kind: "unconfigured" } }),
        provider("groq", { auth: { kind: "unknown" } }),
      ]),
    );

    expect(within(rowOf("Anthropic")).getByText("Подписка")).toBeDefined();
    expect(within(rowOf("Openai")).getByText("Не настроен")).toBeDefined();
    expect(within(rowOf("Groq")).getByText("Сказать нечем")).toBeDefined();
  });

  it("names where the credential came from: from the environment there is no way out", () => {
    show(
      withProviders([
        provider("anthropic", {
          auth: { kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" },
        }),
      ]),
    );

    expect(within(rowOf("Anthropic")).getByText(/ANTHROPIC_API_KEY/)).toBeDefined();
  });

  it("shows the ways in without offering a single button to log in with", () => {
    // Интерактивный вход приезжает отдельно (docs/models-and-providers.md): кнопка, которая ничего
    // не делает, врёт про возможность.
    show(
      withProviders([
        provider("anthropic", {
          logins: [
            { type: "api_key", label: "Anthropic API key" },
            { type: "oauth", label: "Sign in with Claude Pro/Max" },
          ],
        }),
      ]),
    );

    const row = rowOf("Anthropic");

    expect(within(row).getByText(/Anthropic API key/)).toBeDefined();
    expect(within(row).getByText(/Sign in with Claude Pro\/Max/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Войти/ })).toBeNull();
  });

  it("says outright that a provider with no ways in cannot be logged into", () => {
    show(withProviders([provider("bedrock", { logins: [] })]));

    expect(within(rowOf("Bedrock")).getByText(/только из окружения/)).toBeDefined();
  });

  it("counts the models without asking for them", () => {
    show(withProviders([provider("anthropic", { modelCount: 21 })]));

    expect(within(rowOf("Anthropic")).getByText("21 модель")).toBeDefined();
  });

  it("marks a list that comes from the network and a provider of a plugin", () => {
    show(
      withProviders([
        provider("ollama", { dynamic: true, custom: true }),
        provider("anthropic", {}),
      ]),
    );

    expect(within(rowOf("Ollama")).getByText("список из сети")).toBeDefined();
    expect(within(rowOf("Ollama")).getByText("от плагина")).toBeDefined();
    expect(within(rowOf("Anthropic")).queryByText("список из сети")).toBeNull();
  });

  it("asks for the models of the provider the human picked", () => {
    const { onOpen } = show(withProviders([provider("anthropic"), provider("openai")]));

    fireEvent.click(within(rowOf("Openai")).getByRole("button"));

    expect(onOpen).toHaveBeenCalledWith("openai");
  });

  it("shows the models of the open provider with the window and the price", () => {
    const opened = openProvider(withProviders([provider("anthropic")]), "anthropic").state;
    const state = applyModels(opened, "anthropic", [model("claude-opus-4", { name: "Opus 4" })]);

    show(state);

    expect(screen.getByText("Модели: Anthropic")).toBeDefined();
    expect(screen.getByText("Opus 4")).toBeDefined();
    expect(screen.getByText("claude-opus-4")).toBeDefined();
    expect(screen.getByText(/Контекст: 200/)).toBeDefined();
    expect(screen.getByText(/\$3/)).toBeDefined();
  });

  it("waits for the models of the open provider without emptying the list", () => {
    const opened = openProvider(withProviders([provider("anthropic")]), "anthropic").state;

    show(opened);

    expect(screen.getByRole("status")).toBeDefined();
    expect(rowOf("Anthropic")).toBeDefined();
  });

  it("says why the models could not be read and keeps the providers", () => {
    const opened = openProvider(withProviders([provider("anthropic")]), "anthropic").state;

    show(applyModelsFailure(opened, "anthropic", "not found"));

    expect(screen.getByText(/not found/)).toBeDefined();
    expect(rowOf("Anthropic")).toBeDefined();
  });

  it("shows no models of a provider nobody opened", () => {
    const state = applyModels(withProviders([provider("anthropic")]), "anthropic", [
      model("claude-opus-4"),
    ]);

    show(state);

    expect(screen.queryByText("claude-opus-4")).toBeNull();
  });
});
