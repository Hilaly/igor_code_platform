import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { Models, OAuthCredential } from "@earendil-works/pi-ai";

import { resolveKeyAuth } from "./key-auth.ts";
import { emptyEnvironment, inMemoryVault } from "./testing.ts";
import type { CredentialVault } from "./credentials.ts";

const providerId = "subscribed";

const token = (access: string, expires: number): OAuthCredential => ({
  type: "oauth",
  access,
  refresh: "refresh-token",
  expires,
});

const hourAhead = () => Date.now() + 60 * 60 * 1000;
const hourAgo = () => Date.now() - 60 * 60 * 1000;

/**
 * Провайдер с подпиской. Настоящий OAuth требует настоящего аккаунта, поэтому обмен токена здесь
 * изображается: проверяется не он, а замок вокруг него (docs/model-routing.md).
 */
function subscribed(options: { onRefresh?: () => void; delay?: () => Promise<void> } = {}): {
  models: Models;
  refreshes: number;
} {
  const state = { refreshes: 0 };
  const provider = createProvider({
    id: providerId,
    name: "Subscribed",
    models: [],
    api: {
      stream: () => {
        throw new Error("двойник провайдера не отвечает на запросы к модели");
      },
    } as never,
    auth: {
      oauth: {
        name: "Subscribed account",
        login: () => Promise.resolve(token("first", hourAhead())),
        refresh: async () => {
          state.refreshes += 1;
          options.onRefresh?.();
          await options.delay?.();

          return token(`refreshed-${String(state.refreshes)}`, hourAhead());
        },
        toAuth: (credential) => Promise.resolve({ apiKey: credential.access }),
      },
    },
  });
  const models = createModels();

  models.setProvider(provider);

  return {
    models,
    get refreshes() {
      return state.refreshes;
    },
  };
}

const auth = (credentials: CredentialVault, models: Models, keyId: string | undefined) =>
  resolveKeyAuth({ models, credentials, environment: emptyEnvironment(), providerId, keyId });

/** Токен ключа так, как его видит тест: значение креда для платформы непрозрачно. */
async function accessOf(credentials: CredentialVault, keyId: string): Promise<unknown> {
  const stored = await credentials.readKey(providerId, keyId);

  return (stored as OAuthCredential | undefined)?.access;
}

describe("the authorization of a named key", () => {
  it("leaves a live token alone instead of taking the lock for it", async () => {
    const credentials = inMemoryVault({ [providerId]: token("live", hourAhead()) });
    const provider = subscribed();

    assert.deepEqual(await auth(credentials, provider.models, "key-1"), { apiKey: "live" });
    assert.equal(provider.refreshes, 0);
  });

  it("refreshes an expired token once for everybody who asked at the same time", async () => {
    const credentials = inMemoryVault({ [providerId]: token("stale", hourAgo()) });
    let release = (): void => {};
    let started = (): void => {};
    const refreshing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const provider = subscribed({
      onRefresh: () => started(),
      delay: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });

    const first = auth(credentials, provider.models, "key-1");

    await refreshing;

    // Второй спрашивает, пока обмен ещё идёт: без двойной проверки он пошёл бы обменивать тот же
    // протухший токен и сжёг бы его — refresh-токен у большинства провайдеров одноразовый.
    const second = auth(credentials, provider.models, "key-1");

    release();

    assert.deepEqual(await first, { apiKey: "refreshed-1" });
    assert.deepEqual(await second, { apiKey: "refreshed-1" });
    assert.equal(provider.refreshes, 1);
  });

  it("writes the refreshed token into the named key, not into the selected one", async () => {
    const credentials = inMemoryVault();
    const provider = subscribed();

    await credentials.withKeyTarget(providerId, { kind: "new", label: "личный" }, () =>
      credentials.modify(providerId, async () => token("selected", hourAhead())),
    );
    await credentials.withKeyTarget(providerId, { kind: "new", label: "рабочий" }, () =>
      credentials.modify(providerId, async () => token("stale", hourAgo())),
    );

    assert.deepEqual(await auth(credentials, provider.models, "key-2"), { apiKey: "refreshed-1" });
    assert.equal(await accessOf(credentials, "key-1"), "selected");
    assert.equal(await accessOf(credentials, "key-2"), "refreshed-1");
  });

  it("goes on with the token in hand when the key is gone before the refresh is written", async () => {
    const vault = inMemoryVault({ [providerId]: token("stale", hourAgo()) });
    // Выход прошёл между чтением креда и записью обновлённого: параллельный выход — не ошибка, и
    // отказывать в авторизации из-за него нечего, токен на руках ещё жив.
    const credentials: CredentialVault = {
      ...vault,
      readKey: async (provider, keyId) => {
        const stored = await vault.readKey(provider, keyId);

        await vault.removeKey(provider, keyId);

        return stored;
      },
    };
    const provider = subscribed();

    assert.deepEqual(await auth(credentials, provider.models, "key-1"), { apiKey: "stale" });
    assert.equal(provider.refreshes, 0);
  });

  it("says nothing about a provider it does not know and a key it does not have", async () => {
    const credentials = inMemoryVault({ [providerId]: token("live", hourAhead()) });
    const provider = subscribed();

    assert.equal(await auth(credentials, provider.models, "key-9"), undefined);
    assert.equal(await auth(credentials, provider.models, undefined), undefined);
    assert.equal(
      await resolveKeyAuth({
        models: provider.models,
        credentials,
        environment: emptyEnvironment(),
        providerId: "unknown",
        keyId: "key-1",
      }),
      undefined,
    );
  });
});
