import type { ModelSummary, ProviderSummary } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyFailure,
  applyModels,
  applyModelsFailure,
  applySnapshot,
  configuredCount,
  initialProvidersState,
  openProvider,
  orderProviders,
} from "./state.ts";

const provider = (id: string, overrides: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id,
  name: id,
  logins: [{ type: "api_key", label: `${id} API key` }],
  auth: { kind: "unconfigured" },
  dynamic: false,
  custom: false,
  modelCount: 2,
  ...overrides,
});

const configured = (id: string, source?: string): ProviderSummary =>
  provider(id, {
    auth: { kind: "configured", type: "api_key", ...(source === undefined ? {} : { source }) },
  });

const model = (id: string): ModelSummary => ({
  id,
  name: id,
  providerId: "anthropic",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: false,
  input: ["text"],
  cost: { input: 3, output: 15 },
});

const withProviders = (providers: ProviderSummary[]) =>
  applySnapshot(initialProvidersState, { providers });

describe("orderProviders", () => {
  it("puts the ones you can already work with first", () => {
    // Провайдеров 38, а настроенных обычно единицы: искать свой среди чужих по алфавиту значит
    // листать список каждый раз.
    const ordered = orderProviders([
      provider("openai"),
      configured("anthropic"),
      provider("groq"),
      configured("google"),
    ]);

    expect(ordered.map((one) => one.id)).toEqual(["anthropic", "google", "openai", "groq"]);
  });

  it("keeps the order of the runtime inside each group", () => {
    // Порядок каталога рантайма — не случайность, и переставлять его алфавитом незачем.
    const ordered = orderProviders([provider("zed"), provider("amazon"), provider("mistral")]);

    expect(ordered.map((one) => one.id)).toEqual(["zed", "amazon", "mistral"]);
  });

  it("leaves the list alone when nothing is configured", () => {
    // Негодный файл кредов делает статус `unknown` у всех (docs/web-api.md) — группировать нечего.
    const unknown = [provider("a", { auth: { kind: "unknown" } }), provider("b")];

    expect(orderProviders(unknown).map((one) => one.id)).toEqual(["a", "b"]);
  });
});

describe("applySnapshot", () => {
  it("takes the answer whole and drops the failure with it", () => {
    const failed = applyFailure(initialProvidersState, "the daemon answered 500");
    const next = applySnapshot(failed, { providers: [provider("a")] });

    expect(next.failure).toBeUndefined();
    expect(next.snapshot?.providers).toHaveLength(1);
  });

  it("stores the providers already ordered: the view only draws", () => {
    const next = withProviders([provider("openai"), configured("anthropic")]);

    expect(next.snapshot?.providers.map((one) => one.id)).toEqual(["anthropic", "openai"]);
  });

  it("keeps the problem of the snapshot as it came", () => {
    const next = applySnapshot(initialProvidersState, {
      providers: [],
      problem: "credentials.json is not valid json",
    });

    expect(next.snapshot?.problem).toBe("credentials.json is not valid json");
  });
});

describe("openProvider", () => {
  it("opens a provider and asks for its models", () => {
    const outcome = openProvider(withProviders([provider("anthropic")]), "anthropic");

    expect(outcome.fetch).toBe(true);
    expect(outcome.state.openProviderId).toBe("anthropic");
    expect(outcome.state.models["anthropic"]).toEqual({ kind: "loading" });
  });

  it("closes the open one instead of asking again", () => {
    // Выбор той же строки — «закрыть»: иначе развернуть список моделей можно, а свернуть нечем.
    const open = openProvider(withProviders([provider("anthropic")]), "anthropic").state;
    const outcome = openProvider(open, "anthropic");

    expect(outcome.fetch).toBe(false);
    expect(outcome.state.openProviderId).toBeUndefined();
  });

  it("does not ask twice for models it already has", () => {
    const read = applyModels(
      openProvider(withProviders([provider("anthropic")]), "anthropic").state,
      "anthropic",
      [model("claude")],
    );
    const closed = openProvider(read, "anthropic").state;
    const outcome = openProvider(closed, "anthropic");

    expect(outcome.fetch).toBe(false);
    expect(outcome.state.models["anthropic"]).toEqual({ kind: "ready", models: [model("claude")] });
  });

  it("asks again after a failure: the reason may be gone by now", () => {
    const failed = applyModelsFailure(
      openProvider(withProviders([provider("anthropic")]), "anthropic").state,
      "anthropic",
      "the daemon answered 500",
    );
    const closed = openProvider(failed, "anthropic").state;

    expect(openProvider(closed, "anthropic").fetch).toBe(true);
  });
});

describe("applyModels", () => {
  it("keeps the models of every provider apart", () => {
    const first = openProvider(
      withProviders([provider("anthropic"), provider("openai")]),
      "openai",
    );
    const withOpenai = applyModels(first.state, "openai", [model("gpt")]);
    const second = openProvider(withOpenai, "anthropic");
    const both = applyModels(second.state, "anthropic", [model("claude")]);

    expect(both.models["openai"]).toEqual({ kind: "ready", models: [model("gpt")] });
    expect(both.models["anthropic"]).toEqual({ kind: "ready", models: [model("claude")] });
  });
});

describe("applyModelsFailure", () => {
  it("names the reason next to the provider it belongs to", () => {
    const next = applyModelsFailure(withProviders([provider("a")]), "a", "not found");

    expect(next.models["a"]).toEqual({ kind: "failed", reason: "not found" });
    // Отказ по одному провайдеру не трогает список: он читается отдельным запросом.
    expect(next.failure).toBeUndefined();
  });
});

describe("configuredCount", () => {
  it("counts only the providers there is a credential for", () => {
    expect(
      configuredCount([
        configured("anthropic"),
        provider("openai"),
        provider("groq", { auth: { kind: "unknown" } }),
      ]),
    ).toBe(1);
  });
});
