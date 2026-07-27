/**
 * Снимок состояния плагинной системы: ответ на вопрос «как сейчас» для того, о чём шина публикует
 * события (ADR-0041). Поток говорит об изменениях, снимок — о состоянии; подписчик, который только
 * что подключился или потерял часть потока, начинает отсюда.
 */

import type { ContributionRegistration } from "./contribution.ts";
import type { PluginStatus } from "./plugin-lifecycle.ts";

export const pluginsPath = "/api/plugins";

export type PluginsSnapshot = {
  /**
   * Ревизия реестра вкладов на момент снимка. Та же, что в событии `core.plugin.contributions`:
   * по ней клиент понимает, не устарел ли снимок относительно уже полученного события.
   */
  revision: number;
  plugins: PluginStatus[];
  contributions: ContributionRegistration[];
};
