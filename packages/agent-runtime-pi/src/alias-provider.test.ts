import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { aliasProviderId, type ModelAlias } from "@sovereign/protocol";

import { createProviderCatalogue } from "./catalogue.ts";
import { emptyEnvironment, inMemoryVault, scriptedModelProvider } from "./testing.ts";

const alias = (candidates: ModelAlias["candidates"]): ModelAlias => ({
  id: "opus-5",
  name: "Opus 5",
  candidates,
});

function catalogue(options: { credentials?: ReturnType<typeof inMemoryVault> } = {}) {
  const first = scriptedModelProvider({ id: "first", modelId: "big", turns: [] });
  const second = scriptedModelProvider({ id: "second", modelId: "small", turns: [] });

  return createProviderCatalogue({
    credentials: options.credentials ?? inMemoryVault(),
    environment: emptyEnvironment(),
    additionalProviders: [first.provider, second.provider],
  });
}

/** Модель алиаса глазами каталога: именно её harness получает по ссылке `alias/opus-5`. */
function aliasModel(models: MutableModels): Model<Api> {
  const model = models.getModel(aliasProviderId, "opus-5");

  assert.ok(model, "алиас не попал в каталог");

  return model;
}

describe("aliases in the catalogue", () => {
  it("shows an alias as a model of its own provider", async () => {
    const providers = catalogue();

    providers.setAliases([
      alias([
        { providerId: "first", modelId: "big" },
        { providerId: "second", modelId: "small" },
      ]),
    ]);

    const summary = (await providers.snapshot()).providers.find(
      (provider) => provider.id === aliasProviderId,
    );

    assert.ok(summary);
    assert.equal(summary.origin, "alias");
    // Своего входа у алиаса нет: он ходит ключами своих моделей.
    assert.deepEqual(summary.logins, []);
    assert.deepEqual(
      providers.modelsOf(aliasProviderId)?.map((model) => model.id),
      ["opus-5"],
    );
  });

  it("takes the smallest limits of its candidates", () => {
    const providers = catalogue();

    providers.setAliases([
      alias([
        { providerId: "first", modelId: "big" },
        { providerId: "second", modelId: "small" },
      ]),
    ]);

    const model = aliasModel(providers.models);

    // Harness считает бюджет по объявленным числам: завышенные означали бы компакцию, которая
    // приходит слишком поздно.
    assert.equal(model.contextWindow, 128_000);
    assert.equal(model.maxTokens, 4096);
  });

  it("keeps an alias whose candidates are all gone, and says nothing about their limits", () => {
    const providers = catalogue();

    providers.setAliases([alias([{ providerId: "выдуманный", modelId: "нет" }])]);

    // Алиас не исчезает вместе с моделью: иначе сессия на нём перестала бы читаться, а починить
    // список было бы негде.
    assert.equal(aliasModel(providers.models).contextWindow, 128_000);
  });

  it("takes the alias provider out of the catalogue when the last alias goes", () => {
    const providers = catalogue();

    providers.setAliases([alias([{ providerId: "first", modelId: "big" }])]);
    providers.setAliases([]);

    // Пустой провайдер в списке человека — строка, которая ничего не делает.
    assert.equal(providers.models.getProvider(aliasProviderId), undefined);
  });

  it("is configured while at least one of its candidates is", async () => {
    const credentials = inMemoryVault({ first: { type: "api_key", key: "s3cret" } });
    const providers = catalogue({ credentials });

    providers.setAliases([
      alias([
        { providerId: "first", modelId: "big" },
        { providerId: "second", modelId: "small" },
      ]),
    ]);

    assert.equal((await providers.status(aliasProviderId))?.kind, "configured");
  });

  it("says it is not configured while none of its candidates is", async () => {
    const providers = catalogue();

    // Встроенный провайдер без креда и без окружения — единственный честный «не настроен»: у
    // двойника ключ есть всегда, вход это тема другого двойника.
    providers.setAliases([alias([{ providerId: "anthropic", modelId: "claude-opus-4-5" }])]);

    assert.deepEqual(await providers.status(aliasProviderId), { kind: "unconfigured" });
  });

  it("refuses to be streamed straight, instead of asking a provider that is not there", async () => {
    const providers = catalogue();

    providers.setAliases([alias([{ providerId: "first", modelId: "big" }])]);

    // Сюда попадает только тот, кто взял модель алиаса мимо сессии: маршрутизатор подменяет её на
    // кандидата раньше.
    const answer = await providers.models.completeSimple(aliasModel(providers.models), {
      messages: [],
    });

    assert.equal(answer.stopReason, "error");
    assert.match(answer.errorMessage ?? "", /only usable inside an agent session/);
  });

  it("gives the candidates of an alias in the order the human named", () => {
    const providers = catalogue();

    providers.setAliases([
      alias([
        { providerId: "second", modelId: "small" },
        { providerId: "first", modelId: "big" },
      ]),
    ]);

    assert.deepEqual(providers.aliasCandidates("opus-5"), [
      { providerId: "second", modelId: "small" },
      { providerId: "first", modelId: "big" },
    ]);
    assert.equal(providers.aliasCandidates("нет такого"), undefined);
  });
});
