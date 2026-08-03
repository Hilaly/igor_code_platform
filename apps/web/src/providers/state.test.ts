import {
  coreEventTypes,
  streamGapType,
  type BusStreamEvent,
  type ModelSummary,
  type ProviderSummary,
} from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyFailure,
  applyModels,
  applyModelsFailure,
  applySnapshot,
  applyStreamEvent,
  configuredCount,
  initialProvidersState,
  markModelsLoading,
  orderProviders,
  shouldFetchModels,
} from "./state.ts";

const provider = (id: string, overrides: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id,
  name: id,
  logins: [{ type: "api_key", label: `${id} API key` }],
  auth: { kind: "unconfigured" },
  dynamic: false,
  custom: false,
  origin: "builtin",
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

describe("shouldFetchModels", () => {
  it("asks for models it has never read", () => {
    // На страницу провайдера заходят впервые — моделей ещё нет, спрашивать надо.
    expect(shouldFetchModels(withProviders([provider("anthropic")]), "anthropic")).toBe(true);
  });

  it("does not ask twice for models it already has", () => {
    // Прочитанное не перечитывается: каталог моделей лежит в рантайме и сам по себе не меняется.
    const read = markModelsLoading(withProviders([provider("anthropic")]), "anthropic");
    const ready = applyModels(read, "anthropic", [model("claude")]);

    expect(shouldFetchModels(ready, "anthropic")).toBe(false);
  });

  it("does not ask again while a request is in flight", () => {
    // Повторный заход на страницу во время загрузки не должен плодить второй запрос.
    const loading = markModelsLoading(withProviders([provider("anthropic")]), "anthropic");

    expect(shouldFetchModels(loading, "anthropic")).toBe(false);
  });

  it("asks again after a failure: the reason may be gone by now", () => {
    // Отказ — другое дело: причина могла уйти, и повторный заход это единственный способ попробовать.
    const failed = applyModelsFailure(
      markModelsLoading(withProviders([provider("anthropic")]), "anthropic"),
      "anthropic",
      "the daemon answered 500",
    );

    expect(shouldFetchModels(failed, "anthropic")).toBe(true);
  });
});

describe("markModelsLoading", () => {
  it("stands a spinner up for the provider right away", () => {
    const next = markModelsLoading(withProviders([provider("anthropic")]), "anthropic");

    expect(next.models["anthropic"]).toEqual({ kind: "loading" });
  });
});

describe("applyModels", () => {
  it("keeps the models of every provider apart", () => {
    // Каждый провайдер спрашивается отдельно и живёт своей жизнью — у одного список читается, у
    // другого уже отказал.
    const withOpenai = applyModels(
      markModelsLoading(withProviders([provider("anthropic"), provider("openai")]), "openai"),
      "openai",
      [model("gpt")],
    );
    const both = applyModels(markModelsLoading(withOpenai, "anthropic"), "anthropic", [
      model("claude"),
    ]);

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

describe("applyStreamEvent", () => {
  const event = (type: string, payload: unknown = {}): BusStreamEvent =>
    ({ index: 1, time: "2026-07-29T09:11:04.512Z", type, payload }) as BusStreamEvent;

  it("asks for the providers again on a login, a logout and a refreshed catalogue", () => {
    // Что именно изменилось, в нагрузке не написано: вход мог сделать плагин, а состояние
    // авторизации спрашивается у владельца (docs/event-bus.md).
    for (const type of [
      coreEventTypes.providerLogin,
      coreEventTypes.providerLogout,
      coreEventTypes.providersChanged,
    ]) {
      const outcome = applyStreamEvent(initialProvidersState, event(type));

      expect(outcome.providers, type).toBe(true);
      expect(outcome.logins, type).toBe(false);
    }
  });

  it("forgets cached models when a provider catalogue changes", () => {
    const ready = applyModels(initialProvidersState, "vendor", [model("one")]);
    const outcome = applyStreamEvent(ready, event(coreEventTypes.providersChanged));

    expect(outcome.state.models).toEqual({});
  });

  it("asks for the running logins too when part of the stream was missed", () => {
    // Кадр шага входа нумеруется общей нумерацией и пропадает вместе с окном (docs/web-api.md).
    const outcome = applyStreamEvent(
      initialProvidersState,
      event(streamGapType, { requestedIndex: 1, oldestIndex: 9 }),
    );

    expect(outcome.providers).toBe(true);
    expect(outcome.logins).toBe(true);
  });

  it("asks for nothing on an event of somebody else", () => {
    const plugin = {
      index: 1,
      time: "2026-07-29T09:11:04.512Z",
      type: "tracker.task.done",
      payload: {},
      plugin: { id: "tracker", name: "Tracker" },
    } as BusStreamEvent;

    expect(applyStreamEvent(initialProvidersState, plugin)).toEqual({
      state: initialProvidersState,
      providers: false,
      logins: false,
    });
    expect(
      applyStreamEvent(initialProvidersState, event(coreEventTypes.projectsChanged)).providers,
    ).toBe(false);
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
