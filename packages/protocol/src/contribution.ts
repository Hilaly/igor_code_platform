/**
 * Вклад, зарегистрированный в реестре (ADR-0054), — то, чем плагин расширяет платформу. Реестр
 * живёт в демоне, а его результат уходит и в снимок состояния, и в события шины, поэтому форма
 * записи — контракт.
 *
 * Это не то, что объявил плагин: объявленное описывает SDK. Здесь — то, что ядро приняло, с
 * неймспейсом плагина в идентификаторе и с именем плагина рядом.
 */

import type { PluginSource } from "./plugin.ts";

/**
 * Схема нагрузки в виде данных — то, что отдаёт `z.toJSONSchema()`. Сама схема сюда попасть не
 * может: в ней функции, а между воркером и ядром ходит структурное клонирование (ADR-0072).
 */
export type PayloadSchema = Record<string, unknown>;

type RegistrationCommon = {
  /** С неймспейсом: `<pluginId>.<объявленный>` (ADR-0024, ADR-0072). */
  id: string;
  declaredId: string;
  pluginKey: string;
  pluginId: string;
  source: PluginSource;
  title?: string;
  description?: string;
};

/** Общий вид: платформа о нагрузке ничего не знает и ничего с ней не делает. */
export type CustomContributionRegistration = RegistrationCommon & {
  kind: "custom";
  payload?: unknown;
};

/** Событие шины, объявленное плагином (ADR-0072). Идентификатор вклада — имя события. */
export type EventContributionRegistration = RegistrationCommon & {
  kind: "event";
  payloadSchema: PayloadSchema;
};

export type ContributionRegistration =
  CustomContributionRegistration | EventContributionRegistration;

export type ContributionKind = ContributionRegistration["kind"];

/**
 * Спор между вкладами с одинаковым идентификатором и одинаковым рангом источника: не применяется ни
 * один (ADR-0040). Форма — контракт, потому что спор уходит в снимок: диагностика обязана быть
 * заметной в интерфейсе, а не строкой в журнале.
 */
export type ContributionConflict = {
  id: string;
  source: PluginSource;
  /** Ключи плагинов, претендующих на идентификатор. */
  plugins: string[];
};
