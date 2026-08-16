import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LoginNotice, LoginPrompt } from "@sovereign/protocol";

import { createProviderCatalogue } from "./catalogue.ts";
import type { CredentialVault } from "./credentials.ts";
import { emptyEnvironment, inMemoryVault, scriptedProvider } from "./testing.ts";

function withProvider(
  script: Parameters<typeof scriptedProvider>[0] = {},
  credentials: CredentialVault = inMemoryVault(),
) {
  const scripted = scriptedProvider(script);
  const catalogue = createProviderCatalogue({
    credentials,
    environment: emptyEnvironment(),
    additionalProviders: [scripted.provider],
  });

  return { catalogue, credentials, answers: scripted.answers };
}

function recorder(answer: (prompt: LoginPrompt) => Promise<string> = () => Promise.resolve("ok")) {
  const asked: LoginPrompt[] = [];
  const told: LoginNotice[] = [];
  let steps = 0;

  return {
    asked,
    told,
    dialogue: {
      ask: (prompt: LoginPrompt) => {
        asked.push(prompt);

        return answer(prompt);
      },
      tell: (notice: LoginNotice) => told.push(notice),
      nextStepId: () => {
        steps += 1;

        return `step-${String(steps)}`;
      },
    },
  };
}

describe("logging into a provider", () => {
  it("walks the whole dialogue and lets the runtime store the credential", async () => {
    const { catalogue, credentials, answers } = withProvider({
      key: "sk-написанный-сценарием",
      script: [
        { say: { type: "auth_url", url: "https://provider/login" } },
        { ask: { type: "secret", message: "ключ" } },
        { say: { type: "progress", message: "проверяем" } },
      ],
    });
    const { dialogue, asked, told } = recorder(() => Promise.resolve("sk-от-человека"));

    await catalogue.login({ providerId: "scripted", method: "api_key", dialogue });

    assert.deepEqual(
      asked.map((prompt) => prompt.kind),
      ["secret"],
    );
    assert.deepEqual(
      told.map((notice) => notice.kind),
      ["auth-url", "progress"],
    );
    assert.deepEqual(answers, ["sk-от-человека"]);
    // Кред записал рантайм, тем же сериализованным путём, что и обновление токена.
    assert.deepEqual(await credentials.read("scripted"), {
      type: "api_key",
      key: "sk-написанный-сценарием",
    });
  });

  it("shows the provider as configured right after the login", async () => {
    const { catalogue } = withProvider({ script: [{ ask: { type: "secret", message: "ключ" } }] });
    const { dialogue } = recorder();

    await catalogue.login({ providerId: "scripted", method: "api_key", dialogue });

    const summary = (await catalogue.snapshot()).providers.find(
      (provider) => provider.id === "scripted",
    );

    assert.deepEqual(summary?.auth, {
      kind: "configured",
      type: "api_key",
      source: "stored credential",
    });
  });

  it("passes a refusal of the provider through instead of swallowing it", async () => {
    const { catalogue, credentials } = withProvider({ script: [{ fail: "провайдер отказал" }] });
    const { dialogue } = recorder();

    await assert.rejects(
      catalogue.login({ providerId: "scripted", method: "api_key", dialogue }),
      /провайдер отказал/,
    );
    assert.equal(await credentials.read("scripted"), undefined);
  });

  it("stops on the whole-login signal, and writes nothing", async () => {
    const { catalogue, credentials } = withProvider({
      script: [{ ask: { type: "secret", message: "ключ" } }],
    });
    const controller = new AbortController();
    // Человек закрыл диалог: ждущий вопрос отклоняется, вход не доходит до записи.
    const { dialogue } = recorder(() => {
      controller.abort();

      return Promise.reject(new Error("the attempt was cancelled"));
    });

    await assert.rejects(
      catalogue.login({
        providerId: "scripted",
        method: "api_key",
        dialogue,
        signal: controller.signal,
      }),
      /cancelled/,
    );
    assert.equal(await credentials.read("scripted"), undefined);
  });

  it("refuses a way in the provider does not offer", async () => {
    const { catalogue } = withProvider();
    const { dialogue } = recorder();

    await assert.rejects(catalogue.login({ providerId: "scripted", method: "oauth", dialogue }));
  });

  it("adds a key instead of writing over the one that already works", async () => {
    const credentials = inMemoryVault({ scripted: { type: "api_key", key: "первый" } });
    const { catalogue } = withProvider({ key: "второй", script: [] }, credentials);
    const { dialogue } = recorder();

    const keyId = await catalogue.login({
      providerId: "scripted",
      method: "api_key",
      dialogue,
      target: { kind: "new", label: "рабочий" },
    });

    assert.equal(keyId, "key-2");
    assert.deepEqual(credentials.keys("scripted"), [
      { id: "key-1", label: "" },
      { id: "key-2", label: "рабочий" },
    ]);
    // Выбранный не перехватывается: провайдер целиком по-прежнему представлен первым ключом.
    assert.deepEqual(await credentials.read("scripted"), { type: "api_key", key: "первый" });
    assert.deepEqual(await credentials.readKey("scripted", "key-2"), {
      type: "api_key",
      key: "второй",
    });
  });

  it("writes over the named key when the login replaces one", async () => {
    const credentials = inMemoryVault({ scripted: { type: "api_key", key: "протухший" } });
    const { catalogue } = withProvider({ key: "свежий", script: [] }, credentials);
    const { dialogue } = recorder();

    const keyId = await catalogue.login({
      providerId: "scripted",
      method: "api_key",
      dialogue,
      target: { kind: "existing", keyId: "key-1" },
    });

    assert.equal(keyId, "key-1");
    assert.deepEqual(credentials.keys("scripted"), [{ id: "key-1", label: "" }]);
    assert.deepEqual(await credentials.read("scripted"), { type: "api_key", key: "свежий" });
  });

  it("names no key when the login wrote nothing", async () => {
    const { catalogue, credentials } = withProvider({ script: [{ fail: "провайдер отказал" }] });
    const { dialogue } = recorder();

    await assert.rejects(
      catalogue.login({
        providerId: "scripted",
        method: "api_key",
        dialogue,
        target: { kind: "new", label: "рабочий" },
      }),
    );
    assert.deepEqual(credentials.keys("scripted"), []);
  });

  it("shows the keys of a provider in the snapshot, without their values", async () => {
    const credentials = inMemoryVault({ scripted: { type: "api_key", key: "s3cret" } });
    const { catalogue } = withProvider({ key: "второй", script: [] }, credentials);
    const { dialogue } = recorder();

    await catalogue.login({
      providerId: "scripted",
      method: "api_key",
      dialogue,
      target: { kind: "new", label: "рабочий" },
    });

    const summary = (await catalogue.snapshot()).providers.find(
      (provider) => provider.id === "scripted",
    );

    assert.deepEqual(summary?.keys, [
      { id: "key-1", label: "", type: "api_key" },
      { id: "key-2", label: "рабочий", type: "api_key" },
    ]);
    assert.equal(summary?.selectedKey, "key-1");
    assert.ok(!JSON.stringify(summary).includes("s3cret"), "значение ключа уехало во вью");
  });
});

describe("the keys of a provider", () => {
  it("changes the key the provider is represented by", async () => {
    const credentials = inMemoryVault({ scripted: { type: "api_key", key: "первый" } });
    const { catalogue } = withProvider({ key: "второй", script: [] }, credentials);
    const { dialogue } = recorder();

    await catalogue.login({
      providerId: "scripted",
      method: "api_key",
      dialogue,
      target: { kind: "new", label: "" },
    });

    assert.equal(await catalogue.selectKey("scripted", "key-2"), true);
    assert.deepEqual(await credentials.read("scripted"), { type: "api_key", key: "второй" });
    assert.equal(await catalogue.selectKey("scripted", "key-9"), false);
  });

  it("renames a key and removes one without touching the rest", async () => {
    const credentials = inMemoryVault({ scripted: { type: "api_key", key: "первый" } });
    const { catalogue } = withProvider({ key: "второй", script: [] }, credentials);
    const { dialogue } = recorder();

    await catalogue.login({
      providerId: "scripted",
      method: "api_key",
      dialogue,
      target: { kind: "new", label: "" },
    });

    assert.equal(await catalogue.renameKey("scripted", "key-2", "рабочий"), true);
    assert.equal(await catalogue.removeKey("scripted", "key-1"), true);

    assert.deepEqual(credentials.keys("scripted"), [{ id: "key-2", label: "рабочий" }]);
    // Ушёл выбранный — выбранным стал оставшийся, и провайдер остался настроенным.
    assert.deepEqual(await credentials.read("scripted"), { type: "api_key", key: "второй" });
    assert.deepEqual(
      (await catalogue.snapshot()).providers.find((provider) => provider.id === "scripted")?.auth,
      { kind: "configured", type: "api_key", source: "stored credential" },
    );
  });

  it("says nothing about a key whose credential it cannot read", async () => {
    const credentials = inMemoryVault({ scripted: { type: "магия" } });
    const { catalogue } = withProvider({}, credentials);
    const summary = (await catalogue.snapshot()).providers.find(
      (provider) => provider.id === "scripted",
    );

    // Один непонятный кред не прячет от человека остальные ключи и сам ключ тоже не прячет.
    assert.deepEqual(summary?.keys, [{ id: "key-1", label: "" }]);
    assert.deepEqual(summary?.auth, { kind: "unknown" });
  });

  it("shows no keys over a credentials file that cannot be read", async () => {
    const broken: CredentialVault = {
      ...inMemoryVault({ scripted: { type: "api_key", key: "s3cret" } }),
      problem: () => "credentials.json is not valid json",
    };
    const { catalogue } = withProvider({}, broken);
    const summary = (await catalogue.snapshot()).providers.find(
      (provider) => provider.id === "scripted",
    );

    // Набор ключей берётся оттуда же, откуда статус: придуманный список выглядел бы как правда.
    assert.deepEqual(summary?.keys, []);
    assert.equal(summary?.selectedKey, undefined);
  });
});

describe("logging out of a provider", () => {
  it("removes the stored credential and shows the provider unconfigured", async () => {
    const credentials = inMemoryVault({ scripted: { type: "api_key", key: "s3cret" } });
    const { catalogue } = withProvider({}, credentials);

    await catalogue.logout("scripted");

    assert.equal(await credentials.read("scripted"), undefined);
    assert.deepEqual(
      (await catalogue.snapshot()).providers.find((provider) => provider.id === "scripted")?.auth,
      { kind: "unconfigured" },
    );
  });

  it("leaves a provider configured by the environment configured", async () => {
    // Ловушка «нажал выход, ничего не изменилось»: кред из окружения не наш, и убрать его нечем.
    const credentials = inMemoryVault({ anthropic: { type: "api_key", key: "s3cret" } });
    const catalogue = createProviderCatalogue({
      credentials,
      environment: emptyEnvironment({ ANTHROPIC_API_KEY: "не-настоящий" }),
    });

    await catalogue.logout("anthropic");

    assert.equal(await credentials.read("anthropic"), undefined);
    assert.deepEqual(
      (await catalogue.snapshot()).providers.find((provider) => provider.id === "anthropic")?.auth,
      { kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" },
    );
  });
});
