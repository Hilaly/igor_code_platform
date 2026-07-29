/**
 * Наш порт кэша динамических списков моделей и переходник к рантайму.
 *
 * Второе внедряемое хранилище рантайма после кредов. Без него Pi держит каталоги в памяти — за
 * пределы директории данных он ничего не пишет и так, — но тогда динамический список читается из
 * сети на каждый старт демона (docs/data-directory.md).
 *
 * Значение записи непрозрачно (`unknown`) по той же причине, что и у креда: форму знает этот пакет.
 */

import type { ModelsStore, ModelsStoreEntry } from "@earendil-works/pi-ai";

export type ModelCatalogVault = {
  read: (providerId: string) => unknown;
  write: (providerId: string, entry: unknown) => void;
  remove: (providerId: string) => void;
};

export function toRuntimeModelsStore(vault: ModelCatalogVault): ModelsStore {
  return {
    read: (providerId) => Promise.resolve(asEntry(vault.read(providerId))),
    write: (providerId, entry) => {
      vault.write(providerId, entry);

      return Promise.resolve();
    },
    delete: (providerId) => {
      vault.remove(providerId);

      return Promise.resolve();
    },
  };
}

/**
 * Запись без списка моделей — не запись. Отказывать здесь незачем, в отличие от креда: это кэш, и
 * непонятная запись просто считается отсутствующей, а следующий `refresh` перепишет её.
 */
function asEntry(raw: unknown): ModelsStoreEntry | undefined {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as ModelsStoreEntry).models)) {
    return undefined;
  }

  return raw as ModelsStoreEntry;
}
