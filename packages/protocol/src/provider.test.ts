import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  providerCredentialPath,
  providerCredentialPathPattern,
  providerModelsPath,
  providerModelsPathPattern,
  providersPath,
  providersRefreshPath,
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
