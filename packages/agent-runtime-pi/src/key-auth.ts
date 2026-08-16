/**
 * Авторизация одним названным ключом набора (docs/model-routing.md).
 *
 * Рантайм разрешает авторизацию по провайдеру: он читает выбранный кред и ничего не знает о наборе.
 * Сессия ходит **своим** ключом, поэтому его авторизация собирается здесь и уезжает в запрос полем
 * `apiKey` и заголовками — так подмена ключа на запрос устроена у самого Pi
 * (docs/agent-runtime-contract.md).
 *
 * **Обновление OAuth-токена повторяет замок рантайма, но на паре «провайдер и ключ».** Своего пути
 * к нему нет: `Models.getAuth` умеет обновлять только кред выбранного ключа.
 */

import type { Credential, ModelAuth, Models, OAuthCredential } from "@earendil-works/pi-ai";

import type { CredentialVault } from "./credentials.ts";
import type { Environment } from "./environment.ts";
import { toRuntimeAuthContext } from "./environment.ts";

export type ResolveKeyAuthOptions = {
  models: Models;
  credentials: CredentialVault;
  environment: Environment;
  providerId: string;
  /** Ключ набора. `undefined` — ходить кредом провайдера, как это делает рантайм сам. */
  keyId: string | undefined;
};

/**
 * Чем авторизовать запрос этим ключом. `undefined` — ключа нет или провайдер о нём ничего не знает;
 * тогда запрос идёт обычным путём рантайма.
 *
 * Отказ разрешения — исключение, а не `undefined`: «кред есть, но непонятный» и «креда нет» чинятся
 * по-разному, и молчаливое `undefined` увело бы человека искать не там.
 */
export async function resolveKeyAuth(
  options: ResolveKeyAuthOptions,
): Promise<ModelAuth | undefined> {
  const { models, credentials, providerId, keyId } = options;

  if (keyId === undefined) {
    return undefined;
  }

  const provider = models.getProvider(providerId);

  if (provider === undefined) {
    return undefined;
  }

  const credential = asCredential(providerId, keyId, await credentials.readKey(providerId, keyId));

  if (credential === undefined) {
    return undefined;
  }

  if (credential.type === "oauth") {
    const oauth = provider.auth.oauth;

    if (oauth === undefined) {
      throw new Error(`${providerId} has no subscription login, but the key ${keyId} holds one`);
    }

    return oauth.toAuth(await freshOAuth(options, oauth, credential));
  }

  const apiKey = provider.auth.apiKey;

  if (apiKey === undefined) {
    throw new Error(`${providerId} has no key login, but the key ${keyId} holds one`);
  }

  const resolved = await apiKey.resolve({
    ctx: toRuntimeAuthContext(options.environment),
    credential,
  });

  return resolved?.auth;
}

/**
 * Обновление токена под замком набора. Двойная проверка, как у рантайма: годный токен не стоит ни
 * одного замка, а протухший обновляется один раз на всех, потому что второй проверяющий видит уже
 * обновлённый.
 */
async function freshOAuth(
  options: ResolveKeyAuthOptions,
  oauth: NonNullable<NonNullable<ReturnType<Models["getProvider"]>>["auth"]["oauth"]>,
  credential: OAuthCredential,
): Promise<OAuthCredential> {
  const { credentials, providerId, keyId } = options;

  if (Date.now() < credential.expires || keyId === undefined) {
    return credential;
  }

  const written = await credentials.modifyKey(providerId, keyId, async (current) => {
    const stored = asCredential(providerId, keyId, current);

    if (stored?.type !== "oauth") {
      return undefined;
    }

    if (Date.now() < stored.expires) {
      return undefined;
    }

    return oauth.refresh(stored);
  });

  const refreshed = asCredential(providerId, keyId, written);

  // Ключ мог исчезнуть, пока обновлялся токен: выход идёт параллельно и это не ошибка.
  return refreshed?.type === "oauth" ? refreshed : credential;
}

/**
 * Запись с чужим `type` — не «креда нет», а «кред есть, но непонятный»: файл правится руками
 * (docs/models-and-providers.md).
 */
function asCredential(providerId: string, keyId: string, raw: unknown): Credential | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const type =
    typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;

  if (type !== "api_key" && type !== "oauth") {
    throw new Error(
      `the key ${keyId} of ${providerId} has an unknown type ${JSON.stringify(type)} and was not applied`,
    );
  }

  return raw as Credential;
}
