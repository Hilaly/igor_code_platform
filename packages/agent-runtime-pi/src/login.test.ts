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
