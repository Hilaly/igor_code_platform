import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  providerCredentialPath,
  providerCredentialPathPattern,
  providerModelsPath,
  providerModelsPathPattern,
  providerRefreshPath,
  providerRefreshPathPattern,
  providersPath,
} from "./provider.ts";

describe("provider paths", () => {
  it("follow the patterns the daemon route table declares", () => {
    assert.equal(providerModelsPathPattern, `${providersPath}/:providerId/models`);
    assert.equal(providerRefreshPathPattern, `${providersPath}/:providerId/refresh`);
    assert.equal(providerCredentialPathPattern, `${providersPath}/:providerId/credential`);

    assert.equal(providerModelsPath("anthropic"), "/api/providers/anthropic/models");
    assert.equal(providerRefreshPath("anthropic"), "/api/providers/anthropic/refresh");
    assert.equal(providerCredentialPath("anthropic"), "/api/providers/anthropic/credential");
  });

  it("encodes an identifier so it cannot open a second path segment", () => {
    // Идентификатор кастомного провайдера приносит плагин, и он не обязан быть безобидным.
    assert.equal(providerModelsPath("a/b"), "/api/providers/a%2Fb/models");
  });
});
