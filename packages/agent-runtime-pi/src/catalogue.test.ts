import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CustomProviderDefinition, UserProviderDefinition } from "@sovereign/protocol";

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
    assert.ok(snapshot.providers.every((provider) => provider.origin === "builtin"));
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

  it("answers the status of one provider the same way the snapshot does", async () => {
    const credentials = inMemoryVault({ anthropic: { type: "api_key", key: "s3cret" } });
    const one = catalogue({ credentials });
    const snapshot = await one.snapshot();

    assert.deepEqual(
      await one.status("anthropic"),
      snapshot.providers.find((provider) => provider.id === "anthropic")?.auth,
    );
    assert.deepEqual(await one.status("openai"), { kind: "unconfigured" });
    assert.equal(await one.status("выдуманный"), undefined);
  });

  it("says nothing about the status of one provider when the credentials file is unreadable", async () => {
    const broken: CredentialVault = {
      ...inMemoryVault(),
      problem: () => "credentials.json is not valid json",
    };

    // Разные ответы на один вопрос о состоянии — это два разных состояния для того, кто их сверяет.
    assert.deepEqual(await catalogue({ credentials: broken }).status("anthropic"), {
      kind: "unknown",
    });
  });

  it("hands out the models of one provider and nothing for a provider it does not know", () => {
    const models = catalogue().modelsOf("anthropic");

    assert.ok(models);
    assert.ok(models.length > 0);
    assert.ok(models.every((model) => model.providerId === "anthropic"));
    assert.equal(catalogue().modelsOf("выдуманный"), undefined);
  });
});

const vendor: CustomProviderDefinition = {
  id: "vendor-local",
  name: "Vendor Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions",
  apiKey: { label: "Vendor key", environmentVariables: ["VENDOR_API_KEY"] },
  models: [{ id: "vendor-large", name: "Vendor Large", contextWindow: 32_000, maxTokens: 4_096 }],
};

describe("a custom provider", () => {
  it("joins the catalogue marked as custom, with its models", async () => {
    const one = catalogue();

    assert.deepEqual(one.setCustomProvider(vendor), { kind: "registered" });

    const snapshot = await one.snapshot();
    const registered = snapshot.providers.find((provider) => provider.id === vendor.id);

    assert.equal(registered?.custom, true);
    assert.equal(registered?.origin, "plugin");
    assert.equal(registered?.name, "Vendor Local");
    assert.equal(registered?.modelCount, 1);
    assert.deepEqual(registered?.logins, [{ type: "api_key", label: "Vendor key" }]);
    // Встроенные так и остаются не кастомными: метка про принадлежность, а не про способ сборки.
    assert.equal(snapshot.providers.filter((provider) => provider.custom).length, 1);

    assert.deepEqual(one.modelsOf(vendor.id), [
      {
        id: "vendor-large",
        name: "Vendor Large",
        providerId: "vendor-local",
        contextWindow: 32_000,
        maxTokens: 4_096,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0 },
      },
    ]);
  });

  it("refuses an identifier somebody already holds instead of replacing it", async () => {
    const one = catalogue();

    // `setProvider` у рантайма перезаписывает по `id`, и встроенный провайдер исчез бы молча.
    assert.deepEqual(one.setCustomProvider({ ...vendor, id: "anthropic" }), { kind: "taken" });
    assert.deepEqual(one.setCustomProvider(vendor), { kind: "registered" });
    assert.deepEqual(one.setCustomProvider({ ...vendor, name: "Другой" }), { kind: "taken" });

    const anthropic = (await one.snapshot()).providers.find(
      (provider) => provider.id === "anthropic",
    );

    assert.equal(anthropic?.name, "Anthropic");
    assert.equal(anthropic?.custom, false);
  });

  it("goes away when it is deleted, and takes no builtin with it", async () => {
    const one = catalogue();

    one.setCustomProvider(vendor);

    assert.equal(one.deleteCustomProvider(vendor.id), true);
    assert.equal(one.modelsOf(vendor.id), undefined);

    // Встроенного этим не удалить: удаление по чужому идентификатору обеднило бы каталог навсегда.
    assert.equal(one.deleteCustomProvider("anthropic"), false);
    assert.ok((await one.snapshot()).providers.some((provider) => provider.id === "anthropic"));
    assert.equal(one.deleteCustomProvider(vendor.id), false);
  });

  it("keeps the credential of a custom provider in the common store", async () => {
    const credentials = inMemoryVault();
    const one = catalogue({ credentials });

    one.setCustomProvider(vendor);
    await credentials.modify(vendor.id, async () => ({ type: "api_key", key: "s3cret" }));

    assert.deepEqual(await one.status(vendor.id), {
      kind: "configured",
      type: "api_key",
      source: "stored credential",
    });

    // Провайдер ушёл вместе с плагином и вернулся — кред пережил обоих: он лежит в общем файле.
    one.deleteCustomProvider(vendor.id);
    one.setCustomProvider(vendor);

    assert.deepEqual(await one.status(vendor.id), {
      kind: "configured",
      type: "api_key",
      source: "stored credential",
    });
    assert.deepEqual(credentials.list(), [vendor.id]);
  });
});

const userVendor: UserProviderDefinition = {
  id: "user-vendor",
  name: "User Vendor",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-responses",
  modelsEndpoint: { kind: "disabled" },
  modelDefaults: {
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
  },
  manualModels: [
    {
      id: "vendor-model",
      name: "Vendor Model",
      contextWindow: 32_000,
      maxTokens: 4_096,
    },
  ],
  modelOverrides: {},
  disabledModelIds: [],
};

describe("a user provider", () => {
  it("keeps builtin, plugin, and user origins distinct", async () => {
    const one = catalogue();

    assert.deepEqual(one.setCustomProvider(userVendor, "user"), { kind: "registered" });

    const saved = (await one.snapshot()).providers.find(
      (provider) => provider.id === userVendor.id,
    );
    assert.equal(saved?.origin, "user");
    assert.equal(saved?.custom, false);
  });

  it("replaces and removes only a provider owned by the named source", () => {
    const one = catalogue();

    one.setCustomProvider(userVendor, "user");
    assert.equal(
      one.replaceCustomProvider({ ...userVendor, name: "Renamed Vendor" }, "user"),
      true,
    );
    assert.equal(one.modelsOf(userVendor.id)?.[0]?.name, "Vendor Model");
    assert.equal(one.removeCustomProvider(userVendor.id, "plugin"), false);
    assert.equal(one.removeCustomProvider(userVendor.id, "user"), true);
  });
});
