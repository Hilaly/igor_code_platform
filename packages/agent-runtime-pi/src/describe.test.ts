import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { builtinModels } from "@earendil-works/pi-ai/providers/all";

import { describeModel, describeProvider } from "./describe.ts";

const catalogue = builtinModels();

function providerNamed(id: string) {
  const provider = catalogue.getProvider(id);

  assert.ok(provider, `в каталоге Pi нет провайдера ${id}`);

  return provider;
}

describe("describeProvider", () => {
  it("lists both ways in of a provider that has both", () => {
    const summary = describeProvider(providerNamed("anthropic"), {
      auth: { kind: "unconfigured" },
      origin: "builtin",
      keys: [],
    });

    assert.equal(summary.id, "anthropic");
    assert.equal(summary.name, "Anthropic");
    assert.equal(summary.baseUrl, "https://api.anthropic.com");
    assert.deepEqual(summary.logins, [
      { type: "api_key", label: "Anthropic API key" },
      { type: "oauth", label: "Anthropic (Claude Pro/Max)" },
    ]);
    assert.equal(summary.dynamic, false);
    assert.equal(summary.custom, false);
    assert.ok(summary.modelCount > 0);
  });

  it("leaves out the key login of a provider that has none", () => {
    // У openai-codex вообще нет apiKey — вход только через подписку.
    const summary = describeProvider(providerNamed("openai-codex"), {
      auth: { kind: "unconfigured" },
      origin: "builtin",
      keys: [],
    });

    assert.deepEqual(
      summary.logins.map((login) => login.type),
      ["oauth"],
    );
  });

  it("takes the subscription label a provider offers instead of its plain name", () => {
    const provider = providerNamed("xai");
    const oauth = provider.auth.oauth;

    assert.ok(oauth?.loginLabel, "у xai пропал loginLabel — тест проверяет не то, что задуман");
    assert.equal(
      describeProvider(provider, {
        auth: { kind: "unconfigured" },
        origin: "builtin",
        keys: [],
      }).logins.find((login) => login.type === "oauth")?.label,
      oauth.loginLabel,
    );
  });

  it("marks a provider whose model list arrives from the network", () => {
    const summary = describeProvider(providerNamed("radius"), {
      auth: { kind: "unconfigured" },
      origin: "builtin",
      keys: [],
    });

    assert.equal(summary.dynamic, true);
    // До первого refresh список пуст, и это состояние, а не ошибка.
    assert.equal(summary.modelCount, 0);
  });

  it("carries the auth state and derives the custom flag from origin", () => {
    const summary = describeProvider(providerNamed("anthropic"), {
      auth: { kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" },
      origin: "plugin",
      keys: [{ id: "key-1", label: "личный", type: "api_key" }],
      selectedKey: "key-1",
    });

    assert.deepEqual(summary.auth, {
      kind: "configured",
      type: "api_key",
      source: "ANTHROPIC_API_KEY",
    });
    assert.equal(summary.custom, true);
  });

  it("survives a provider whose model list throws", () => {
    // Контракт Pi: getModels() «must not throw», а Models считает бросающую реализацию пустой.
    // Каталог кастомных провайдеров приносит плагин, и полагаться на его дисциплину нельзя.
    const broken = {
      ...providerNamed("anthropic"),
      getModels: () => {
        throw new Error("каталог сломан");
      },
    };

    assert.equal(
      describeProvider(broken, { auth: { kind: "unknown" }, origin: "plugin", keys: [] })
        .modelCount,
      0,
    );
  });
});

describe("describeModel", () => {
  it("keeps what the models view shows and drops the rest", () => {
    const model = catalogue.getModel("anthropic", "claude-opus-4-5");

    assert.ok(model, "в каталоге Pi нет модели claude-opus-4-5");
    assert.deepEqual(describeModel(model), {
      id: model.id,
      name: model.name,
      providerId: "anthropic",
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      input: model.input,
      cost: { input: model.cost.input, output: model.cost.output },
    });
  });
});
