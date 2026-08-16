/**
 * Язык окна для плагина (docs/ui-kit.md, docs/ui-extension-model.md). Локаль — такая же
 * характеристика окна, как шина событий: человек выбирает язык один раз на всё окно, и своей
 * настройки языка у плагина нет.
 *
 * Каталоги переводчик берёт из того же снимка `/api/plugins`, которым приезжают остальные вклады:
 * плагин объявляет их воркером (`contribute.localeCatalog`), а браузерная половина ничего не
 * объявляет и ничего не спрашивает. Поэтому строки в бандл не попадают вовсе и разойтись с
 * объявленными не могут.
 */

import type { ContributionRegistration } from "@sovereign/protocol";
import { baseCatalogLocale, createTranslator, type CatalogRegistration } from "@sovereign/ui-kit";
import { useContext, useMemo } from "react";

import { BrowserRuntimeContext } from "./runtime-context.tsx";

/** Каталоги, объявленные плагинами. Форму проверил демон, содержание никто не проверяет — его нет. */
export function pluginCatalogs(
  contributions: readonly ContributionRegistration[],
): CatalogRegistration[] {
  return contributions
    .filter((registration) => registration.kind === "locale-catalog")
    .map(({ namespace, locale, messages }) => ({ namespace, locale, messages }));
}

/**
 * Переводчик плагина в его неймспейсе. Промах перевода уходит в диагностику окна — туда же, куда её
 * пишет ядро: `console.warn` в браузере плагина увидел бы только тот, кто в этот момент смотрит в
 * консоль.
 */
export function useTranslator(namespace: string) {
  const runtime = useContext(BrowserRuntimeContext);
  const contributions = runtime?.contributions;
  const onDiagnostic = runtime?.onDiagnostic;
  const catalogs = useMemo(() => pluginCatalogs(contributions ?? []), [contributions]);
  const translator = useMemo(
    () =>
      createTranslator({
        locale: runtime?.locale ?? baseCatalogLocale,
        namespace,
        catalogs,
        onDiagnostic: onDiagnostic ?? (() => {}),
      }),
    [runtime?.locale, namespace, catalogs, onDiagnostic],
  );

  // Проверка после хуков намеренно: правило React требует одинакового числа вызовов на каждый
  // рендер, а вне провайдера этот компонент всё равно не отрисуется дважды.
  if (runtime === undefined) {
    throw new Error("useTranslator must be used inside BrowserRuntimeProvider");
  }

  return translator;
}
