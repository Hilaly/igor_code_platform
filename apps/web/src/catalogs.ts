/**
 * Каталоги сообщений: поставки и приехавшие от плагинов (docs/ui-kit.md). Каталог — данные, поэтому
 * от плагина он доезжает тем же снимком `/api/plugins`, что и остальные вклады (docs/plugins.md).
 */

import { pluginCatalogs } from "@sovereign/browser-sdk/host";
import {
  coreEnglish,
  coreNamespace,
  coreRussian,
  type CatalogRegistration,
} from "@sovereign/ui-kit";

/**
 * Отбор каталогов из снимка живёт в браузерном SDK: там же его читает переводчик плагина
 * (`useTranslator`), и два одинаковых фильтра разошлись бы на первой правке вклада.
 */
export { pluginCatalogs };

/**
 * Каталоги поставки. Порядок значим: каталоги применяются по очереди и побеждают по каждому
 * сообщению отдельно, поэтому каталог плагина обязан идти после наших.
 */
export const shippedCatalogs: readonly CatalogRegistration[] = [coreEnglish, coreRussian];

/**
 * Языки, которые можно выбрать. Считаются **только по каталогам неймспейса `core`**: каталог плагина
 * в своём неймспейсе переводит строки самого плагина и языка платформе не добавляет — выбрав его,
 * человек получил бы английский интерфейс с парой переведённых строк в одной карточке.
 *
 * Порядок — порядок каталогов, повторы схлопываются: один язык могут прислать несколько плагинов.
 */
export function availableLocales(catalogs: readonly CatalogRegistration[]): string[] {
  return [
    ...new Set(
      catalogs
        .filter((catalog) => catalog.namespace === coreNamespace)
        .map((catalog) => catalog.locale),
    ),
  ];
}
