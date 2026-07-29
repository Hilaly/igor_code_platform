import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProviderCatalogue } from "./catalogue.ts";
import type { CredentialVault } from "./credentials.ts";
import { emptyEnvironment, inMemoryVault } from "./testing.ts";

function catalogue(
  options: { credentials?: CredentialVault; variables?: Record<string, string> } = {},
) {
  return createProviderCatalogue({
    credentials: options.credentials ?? inMemoryVault(),
    environment: emptyEnvironment(options.variables),
  });
}

describe("the provider catalogue", () => {
  it("brings every builtin provider unconfigured when nothing is stored", async () => {
    const snapshot = await catalogue().snapshot();

    assert.ok(snapshot.providers.length >= 38);
    assert.equal(snapshot.problem, undefined);
    assert.ok(snapshot.providers.every((provider) => provider.auth.kind === "unconfigured"));
    assert.ok(snapshot.providers.every((provider) => !provider.custom));
  });

  it("keeps providers in a stable order so the view does not jump", async () => {
    const first = (await catalogue().snapshot()).providers.map((provider) => provider.id);
    const second = (await catalogue().snapshot()).providers.map((provider) => provider.id);

    assert.deepEqual(first, second);
    assert.deepEqual(
      first,
      [...first].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("reports a provider configured by a stored key, naming the runtime as the source", async () => {
    const credentials = inMemoryVault({ anthropic: { type: "api_key", key: "s3cret" } });
    const snapshot = await catalogue({ credentials }).snapshot();
    const anthropic = snapshot.providers.find((provider) => provider.id === "anthropic");

    assert.deepEqual(anthropic?.auth, {
      kind: "configured",
      type: "api_key",
      source: "stored credential",
    });
  });

  it("reports a provider configured by the environment, naming the variable", async () => {
    const snapshot = await catalogue({
      variables: { ANTHROPIC_API_KEY: "не-настоящий" },
    }).snapshot();
    const anthropic = snapshot.providers.find((provider) => provider.id === "anthropic");

    // Подпись — единственное, по чему человек поймёт, почему из провайдера не выйти.
    assert.deepEqual(anthropic?.auth, {
      kind: "configured",
      type: "api_key",
      source: "ANTHROPIC_API_KEY",
    });
  });

  it("says nothing about auth when the credentials file cannot be read", async () => {
    const broken: CredentialVault = {
      ...inMemoryVault(),
      problem: () => "credentials.json is not valid json",
    };
    const snapshot = await catalogue({ credentials: broken }).snapshot();

    // Каталог от файла не зависит, поэтому список отдаётся: пустое вью чинить файл не помогает.
    assert.ok(snapshot.providers.length >= 38);
    assert.equal(snapshot.problem, "credentials.json is not valid json");
    assert.ok(snapshot.providers.every((provider) => provider.auth.kind === "unknown"));
  });

  it("says nothing about auth of the one provider whose credential is unreadable", async () => {
    const credentials = inMemoryVault({
      anthropic: { type: "магия" },
      openai: { type: "api_key", key: "s3cret" },
    });
    const snapshot = await catalogue({ credentials }).snapshot();
    const byId = new Map(snapshot.providers.map((provider) => [provider.id, provider]));

    assert.deepEqual(byId.get("anthropic")?.auth, { kind: "unknown" });
    assert.equal(byId.get("openai")?.auth.kind, "configured");
    assert.equal(snapshot.problem, undefined);
  });

  it("asks for the status without refreshing an expired token", async () => {
    // Единственная разница между checkAuth и getAuth, которую видно снаружи: getAuth обновляет
    // протухший OAuth-токен, то есть идёт в сеть и пишет в хранилище прямо на отрисовке вью.
    // Заодно это защита от `ApiKeyAuth.resolve`, которому Pi разрешает исполнять команды.
    const touched: string[] = [];
    const stored = inMemoryVault({
      anthropic: { type: "oauth", access: "a", refresh: "r", expires: Date.now() - 1000 },
    });
    const credentials: CredentialVault = {
      ...stored,
      modify: (providerId, write) => {
        touched.push(providerId);

        return stored.modify(providerId, write);
      },
    };

    const snapshot = await catalogue({ credentials }).snapshot();
    const anthropic = snapshot.providers.find((provider) => provider.id === "anthropic");

    assert.deepEqual(touched, [], "снимок провайдеров полез обновлять токен");
    assert.deepEqual(anthropic?.auth, { kind: "configured", type: "oauth", source: "OAuth" });
  });

  it("hands out the models of one provider and nothing for a provider it does not know", () => {
    const models = catalogue().models("anthropic");

    assert.ok(models);
    assert.ok(models.length > 0);
    assert.ok(models.every((model) => model.providerId === "anthropic"));
    assert.equal(catalogue().models("выдуманный"), undefined);
  });
});
