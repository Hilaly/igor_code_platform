/**
 * Наш порт хранилища кредов и переходник к рантайму (docs/models-and-providers.md).
 *
 * Порт принимает и отдаёт непрозрачный блоб: разметку `type` считает этот пакет — он единственный,
 * кто знает форму креда. Так «платформа не читает значение креда» держится типами.
 */

import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/** Хранилище кредов глазами рантайма. Реализует его демон (`apps/daemon/src/credential-store.ts`). */
export type CredentialVault = {
  read: (providerId: string) => Promise<unknown>;
  /** Идентификаторы провайдеров, у которых есть кред. */
  list: () => string[];
  /** Единственный путь записи: сериализованный read-modify-write по идентификатору провайдера. */
  modify: (providerId: string, write: (current: unknown) => Promise<unknown>) => Promise<unknown>;
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
