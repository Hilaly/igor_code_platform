/**
 * Собранный браузерный код плагинов в памяти демона (docs/ui-extension-model.md,
 * docs/data-directory.md). На диск он не пишется: у каждой ревизии свой неизменяемый адрес, и файл
 * рядом с директорией данных был бы копией того, что и так можно пересобрать за миллисекунды.
 *
 * Ревизий на плагин хранится больше одной, потому что выгрузить старый ES-модуль из кеша браузера
 * нельзя: страница, открытая до перезагрузки плагина, продолжает жить на прежней ревизии и вправе
 * дозапросить её карту кода.
 */

import type { PluginBrowserBundle } from "./plugin-browser-build.ts";

/**
 * Сколько ревизий одного плагина остаётся доступными. Две — текущая и та, на которой ещё живёт
 * открытая страница. Третья не нужна: между двумя перезагрузками плагина страница либо обновилась,
 * либо ей всё равно пора.
 */
export const retainedRevisionCount = 2;

export type PluginAssetStore = {
  /** Положить новую ревизию; самая старая сверх лимита вытесняется. */
  put: (pluginKey: string, bundle: PluginBrowserBundle) => void;
  /** Файл ревизии или `undefined`, если ревизии больше нет или файла в ней не было. */
  read: (pluginKey: string, revision: string, file: string) => Uint8Array | undefined;
  /** Забыть плагин целиком: он выключен, остановлен или исчез с диска. */
  forget: (pluginKey: string) => void;
  /** Сколько ревизий сейчас помнится про плагин. Нужно проверке вытеснения. */
  revisions: (pluginKey: string) => string[];
};

export function createPluginAssetStore(): PluginAssetStore {
  // Новая ревизия в голову: перечисление совпадает с порядком «сначала актуальное».
  const bundles = new Map<string, PluginBrowserBundle[]>();

  return {
    put: (pluginKey, bundle) => {
      const kept = (bundles.get(pluginKey) ?? []).filter(
        (previous) => previous.revision !== bundle.revision,
      );

      bundles.set(pluginKey, [bundle, ...kept].slice(0, retainedRevisionCount));
    },
    read: (pluginKey, revision, file) =>
      bundles
        .get(pluginKey)
        ?.find((bundle) => bundle.revision === revision)
        ?.files.get(file),
    forget: (pluginKey) => {
      bundles.delete(pluginKey);
    },
    revisions: (pluginKey) => (bundles.get(pluginKey) ?? []).map((bundle) => bundle.revision),
  };
}
