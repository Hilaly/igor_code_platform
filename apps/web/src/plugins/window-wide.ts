/**
 * Отбор вкладов, которым позволено действовать на всё окно: цветовая схема, каталог сообщений и всё
 * прочее, что применяется до и помимо открытого проекта.
 */

import { projectOfContribution, type ContributionRegistration } from "@sovereign/protocol";

/**
 * Вклады всего узла: без принадлежащих проекту.
 *
 * Снимок `/api/plugins` — каталог объявлений всех контекстов сразу (docs/plugins.md), поэтому копия
 * плагина в папке проекта приезжает в браузер рядом с копией из директории данных. Для вкладов,
 * применяемых **ко всему окну**, это негодный набор: один и тот же `id` встречается дважды, и что
 * такое «выбранная схема», перестаёт быть определено. Проектный контекст у окна вообще не один — на
 * экране может не быть открытого проекта вовсе, — поэтому окно берёт только вклады узла.
 */
export function windowWideContributions(
  contributions: readonly ContributionRegistration[],
): ContributionRegistration[] {
  return contributions.filter((registration) => projectOfContribution(registration) === undefined);
}
