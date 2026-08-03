import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultModelsUrl,
  defaultUserModelDefinition,
  parseUserProviderDraft,
  providerCredentialPath,
  providerCredentialPathPattern,
  providerModelsPath,
  providerModelsPathPattern,
  providersPath,
  providersRefreshPath,
  userProviderPath,
  userProviderRefreshPath,
  userProvidersPath,
} from "./provider.ts";

describe("provider paths", () => {
  it("follow the patterns the daemon route table declares", () => {
    assert.equal(providerModelsPathPattern, `${providersPath}/:providerId/models`);
    assert.equal(providerCredentialPathPattern, `${providersPath}/:providerId/credential`);

    assert.equal(providerModelsPath("anthropic"), "/api/providers/anthropic/models");
    assert.equal(providerCredentialPath("anthropic"), "/api/providers/anthropic/credential");
  });

  it("keeps the refresh path free of a provider segment", () => {
    // Обновление одного провайдера рантайм не умеет, и путь не должен обещать того, чего нет.
    assert.equal(providersRefreshPath, "/api/providers/refresh");
    // Сегментов у него три, у шаблонов с `:providerId` — четыре: конфликта в таблице маршрутов нет.
    assert.equal(providersRefreshPath.split("/").length, 4);
    assert.equal(providerModelsPathPattern.split("/").length, 5);
  });

  it("encodes an identifier so it cannot open a second path segment", () => {
    // Идентификатор кастомного провайдера приносит плагин, и он не обязан быть безобидным.
    assert.equal(providerModelsPath("a/b"), "/api/providers/a%2Fb/models");
  });
});

describe("user provider paths", () => {
  it("encodes provider identifiers as one path segment", () => {
    assert.equal(userProvidersPath, "/api/user-providers");
    assert.equal(userProviderPath("a/b"), "/api/user-providers/a%2Fb");
    assert.equal(
      userProviderRefreshPath("vendor-local"),
      "/api/user-providers/vendor-local/models/refresh",
    );
  });
});

describe("defaultModelsUrl", () => {
  it("derives the protocol-specific model endpoint", () => {
    assert.equal(
      defaultModelsUrl("openai-responses", "http://localhost:11434/v1"),
      "http://localhost:11434/v1/models",
    );
    assert.equal(
      defaultModelsUrl("anthropic-messages", "https://vendor.test"),
      "https://vendor.test/v1/models",
    );
    assert.equal(
      defaultModelsUrl("anthropic-messages", "https://vendor.test/v1"),
      "https://vendor.test/v1/models",
    );
    assert.equal(
      defaultModelsUrl("google-generative-ai", "https://vendor.test/v1beta"),
      "https://vendor.test/v1beta/models",
    );
  });
});

describe("parseUserProviderDraft", () => {
  const raw = {
    id: "vendor-local",
    name: "Vendor Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-responses",
    modelsEndpoint: { kind: "default" },
    manualModels: [],
    modelOverrides: {},
    disabledModelIds: [],
  };

  it("fills the agreed defaults for discovered models", () => {
    const parsed = parseUserProviderDraft(raw);

    assert.equal(parsed.kind, "parsed");
    if (parsed.kind === "parsed") {
      assert.deepEqual(parsed.value.modelDefaults, defaultUserModelDefinition);
    }
  });

  it("refuses unsafe identifiers, credential-bearing URLs, and invalid numbers", () => {
    for (const candidate of [
      { ...raw, id: "Vendor Local" },
      { ...raw, baseUrl: "https://key@example.test/v1" },
      { ...raw, modelDefaults: { ...defaultUserModelDefinition, contextWindow: 0 } },
    ]) {
      assert.equal(parseUserProviderDraft(candidate).kind, "rejected");
    }
  });

  it("takes custom and disabled model discovery modes", () => {
    assert.equal(
      parseUserProviderDraft({
        ...raw,
        modelsEndpoint: { kind: "custom", url: "http://localhost:11434/catalog" },
      }).kind,
      "parsed",
    );
    assert.equal(
      parseUserProviderDraft({ ...raw, modelsEndpoint: { kind: "disabled" } }).kind,
      "parsed",
    );
  });
});
