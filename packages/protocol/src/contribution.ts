/**
 * Вклад, зарегистрированный в реестре (ADR-0054), — то, чем плагин расширяет платформу. Реестр
 * живёт в демоне, а его результат уходит и в снимок состояния, и в события шины, поэтому форма
 * записи — контракт.
 *
 * Это не то, что объявил плагин: объявленное описывает SDK. Здесь — то, что ядро приняло, с
 * неймспейсом плагина в идентификаторе и с именем плагина рядом.
 */

import type { PluginSource } from "./plugin.ts";

export type ContributionRegistration = {
  /** С неймспейсом: `<pluginId>.<объявленный>` (ADR-0024, ADR-0060). */
  id: string;
  declaredId: string;
  kind: "custom";
  pluginKey: string;
  pluginId: string;
  source: PluginSource;
  title?: string;
  description?: string;
  payload?: unknown;
};
