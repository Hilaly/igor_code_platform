/**
 * Наш порт хранилища кредов и переходник к рантайму (docs/models-and-providers.md).
 *
 * Порт принимает и отдаёт непрозрачный блоб: разметку `type` считает этот пакет — он единственный,
 * кто знает форму креда. Так «платформа не читает значение креда» держится типами.
 */

import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import type { LoginKeyTarget, ProviderKeySummary } from "@sovereign/protocol";

/** Ключ провайдера глазами рантайма: обёртка принадлежит платформе, значение — этому пакету. */
export type VaultKey = { id: string; label: string };

/** Хранилище кредов глазами рантайма. Реализует его демон (`apps/daemon/src/credential-store.ts`). */
export type CredentialVault = {
  /** Кред выбранного ключа. Этим путём провайдера читает рантайм, и про набор он не знает. */
  read: (providerId: string) => Promise<unknown>;
  /** Идентификаторы провайдеров, у которых есть кред. */
  list: () => string[];
  /** Ключи провайдера в порядке добавления. */
  keys: (providerId: string) => VaultKey[];
  /** Какой ключ выбран. `undefined` — у провайдера нет ни одного. */
  selected: (providerId: string) => string | undefined;
  /** Кред названного ключа. */
  readKey: (providerId: string, keyId: string) => Promise<unknown>;
  /** Единственный путь записи: сериализованный read-modify-write по идентификатору провайдера. */
  modify: (providerId: string, write: (current: unknown) => Promise<unknown>) => Promise<unknown>;
  /** То же, но в названный ключ. */
  modifyKey: (
    providerId: string,
    keyId: string,
    write: (current: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
  /** Направить запись входа в названную цель и сказать, в какой ключ записали. */
  withKeyTarget: <Result>(
    providerId: string,
    target: LoginKeyTarget,
    run: () => Promise<Result>,
  ) => Promise<{ result: Result; keyId: string | undefined }>;
  select: (providerId: string, keyId: string) => Promise<boolean>;
  rename: (providerId: string, keyId: string, label: string) => Promise<boolean>;
  removeKey: (providerId: string, keyId: string) => Promise<boolean>;
  remove: (providerId: string) => Promise<void>;
  /** Почему кредам верить нельзя, если верить нельзя. */
  problem: () => string | undefined;
};

export function toRuntimeCredentialStore(vault: CredentialVault): CredentialStore {
  return {
    read: async (providerId) => asCredential(providerId, await vault.read(providerId)),
    list: async (): Promise<readonly CredentialInfo[]> => {
      const listed = await Promise.all(
        vault.list().map(async (providerId): Promise<CredentialInfo | undefined> => {
          const credential = asCredential(providerId, await vault.read(providerId));

          return credential === undefined ? undefined : { providerId, type: credential.type };
        }),
      );

      // Кред мог исчезнуть между перечислением и чтением: логаут идёт параллельно и это не ошибка.
      return listed.filter((info): info is CredentialInfo => info !== undefined);
    },
    modify: async (providerId, write) =>
      asCredential(
        providerId,
        await vault.modify(providerId, async (current) => write(asCredential(providerId, current))),
      ),
    delete: (providerId) => vault.remove(providerId),
  };
}

/**
 * Ключи провайдера для вью. Способ авторизации читается из значения креда — это знание о форме, и
 * живёт оно здесь, а не в платформе.
 *
 * **Непонятный кред не роняет список**: у такого ключа просто нет `type`. Ронять весь набор из-за
 * одной правки руками значило бы прятать от человека и остальные ключи, которые целы.
 */
export async function describeKeys(
  vault: Pick<CredentialVault, "keys" | "readKey">,
  providerId: string,
): Promise<ProviderKeySummary[]> {
  return Promise.all(
    vault.keys(providerId).map(async ({ id, label }): Promise<ProviderKeySummary> => {
      try {
        const credential = asCredential(`${providerId}/${id}`, await vault.readKey(providerId, id));

        return credential === undefined ? { id, label } : { id, label, type: credential.type };
      } catch {
        return { id, label };
      }
    }),
  );
}

/**
 * Запись с чужим `type` — не «креда нет», а «кред есть, но непонятный»: файл правится руками, и
 * молчаливое `undefined` выглядело бы для человека внезапным разлогином. Рантайм заворачивает такой
 * отказ в ошибку авторизации этого провайдера, остальных он не задевает.
 */
function asCredential(providerId: string, raw: unknown): Credential | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const type =
    typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;

  if (type !== "api_key" && type !== "oauth") {
    throw new Error(
      `the credential of ${providerId} has an unknown type ${JSON.stringify(type)} and was not applied`,
    );
  }

  return raw as Credential;
}
