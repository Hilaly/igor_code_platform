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

import { coreCatalogNamespace, type ContributionRegistration } from "@sovereign/protocol";
import {
  baseCatalogLocale,
  createTranslator,
  type CatalogRegistration,
  type Translator,
} from "@sovereign/ui-kit";
import { useCallback, useContext, useMemo } from "react";

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
 * Переводчик каталогов снимка. Вне провайдера отдаёт переводчик без каталогов, а не бросает: им
 * подписывает вклады сам хост, и полоса вкладок не имеет права падать из-за отсутствия рантайма.
 */
function useSnapshotTranslator(namespace: string): Translator {
  const runtime = useContext(BrowserRuntimeContext);
  const contributions = runtime?.contributions;
  const onDiagnostic = runtime?.onDiagnostic;
  const catalogs = useMemo(() => pluginCatalogs(contributions ?? []), [contributions]);

  return useMemo(
    () =>
      createTranslator({
        locale: runtime?.locale ?? baseCatalogLocale,
        namespace,
        catalogs,
        onDiagnostic: onDiagnostic ?? (() => {}),
      }),
    [runtime?.locale, namespace, catalogs, onDiagnostic],
  );
}

/**
 * Переводчик плагина в его неймспейсе. Промах перевода уходит в диагностику окна — туда же, куда её
 * пишет ядро: `console.warn` в браузере плагина увидел бы только тот, кто в этот момент смотрит в
 * консоль.
 */
export function useTranslator(namespace: string): Translator {
  const runtime = useContext(BrowserRuntimeContext);
  const translator = useSnapshotTranslator(namespace);

  // Проверка после хуков намеренно: число вызовов хуков обязано быть одинаковым на каждый рендер.
  if (runtime === undefined) {
    throw new Error("useTranslator must be used inside BrowserRuntimeProvider");
  }

  return translator;
}

/**
 * Подпись вклада для человека — лестницей в три ступени: перевод в неймспейсе плагина по ключу
 * `<вид>.<объявленный id>.title` → `title` объявления → объявленный идентификатор.
 *
 * Отдельного поля под ключ у вклада нет: `title` есть у каждого, а ключ выводится из вида и
 * идентификатора, которые у вклада тоже есть всегда. Перевода может законно не быть — потому здесь
 * `optional`, а не `t`: `t` вернул бы сам ключ и записал ложную жалобу на дырку в каталоге.
 */
export function contributionTitle(
  registration: ContributionRegistration,
  translator: Translator,
): string {
  const namespace =
    registration.ownership === "plugin" ? registration.pluginId : registration.source;

  return (
    translator.scope(namespace).optional(`${registration.kind}.${registration.declaredId}.title`) ??
    registration.title ??
    registration.declaredId
  );
}

/** Та же лестница внутри рантайма: переводчик берётся у снимка, а не приносится вызывающим. */
export function useContributionTitle(): (registration: ContributionRegistration) => string {
  const translator = useSnapshotTranslator(coreCatalogNamespace);

  return useCallback((registration) => contributionTitle(registration, translator), [translator]);
}
