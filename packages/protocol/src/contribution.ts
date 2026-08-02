/**
 * Вклад, зарегистрированный в реестре (docs/plugins.md), — то, чем плагин расширяет платформу. Реестр
 * живёт в демоне, а его результат уходит и в снимок состояния, и в события шины, поэтому форма
 * записи — контракт.
 *
 * Это не то, что объявил плагин: объявленное описывает SDK. Здесь — то, что ядро приняло, с
 * неймспейсом плагина в идентификаторе и с именем плагина рядом.
 */

import type { PluginSource } from "./plugin.ts";
import type { ThinkingLevel } from "./session.ts";
import type { AgentSkillSelection, AgentToolSelection } from "./tool-pattern.ts";

/**
 * Схема нагрузки в виде данных — то, что отдаёт `z.toJSONSchema()`. Сама схема сюда попасть не
 * может: в ней функции, а между воркером и ядром ходит структурное клонирование (docs/event-bus.md).
 */
export type PayloadSchema = Record<string, unknown>;

export type ContributionOwnership =
  | {
      ownership: "plugin";
      pluginKey: string;
      pluginId: string;
      source: PluginSource;
    }
  | {
      ownership: "standalone";
      /** Точный ключ нативного или межклиентского корня. */
      source: string;
      scope: "user" | "project";
      projectId?: string;
    };

export type RegistrationCommon = ContributionOwnership & {
  /** С неймспейсом: `<pluginId>.<объявленный>` (docs/ui-extension-model.md, docs/event-bus.md). */
  id: string;
  declaredId: string;
  title?: string;
  description?: string;
};

/** Общий вид: платформа о нагрузке ничего не знает и ничего с ней не делает. */
export type CustomContributionRegistration = RegistrationCommon & {
  kind: "custom";
  payload?: unknown;
};

/** Событие шины, объявленное плагином (docs/event-bus.md). Идентификатор вклада — имя события. */
export type EventContributionRegistration = RegistrationCommon & {
  kind: "event";
  payloadSchema: PayloadSchema;
};

/**
 * Агент: инструкции плюс отбор инструментов (docs/plugins.md). Модель и уровень ризонинга —
 * умолчания, а не запрет: при создании сессии их переопределяют.
 *
 * Проверить отбор при регистрации нельзя — шаблон вправе не совпасть ни с одним инструментом,
 * потому что набор собирается на каждый турн и зависит от того, какие плагины сейчас включены.
 * Поэтому «агент, у которого не осталось ни одного инструмента» — законное состояние.
 */
export type AgentContributionRegistration = RegistrationCommon & {
  kind: "agent";
  instructions: string;
  tools: AgentToolSelection;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  skills: AgentSkillSelection;
};

/** Скил из файла: реестр хранит разобранные метаданные, но не текст Markdown. */
export type SkillContributionRegistration = RegistrationCommon & {
  kind: "skill";
  name: string;
  location: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  disableModelInvocation: boolean;
};

export type ContributionRegistration =
  | CustomContributionRegistration
  | EventContributionRegistration
  | AgentContributionRegistration
  | SkillContributionRegistration;

export type ContributionKind = ContributionRegistration["kind"];

/**
 * Спор между вкладами с одинаковым идентификатором и одинаковым рангом источника: не применяется ни
 * один (docs/plugins.md). Форма — контракт, потому что спор уходит в снимок: диагностика обязана быть
 * заметной в интерфейсе, а не строкой в журнале.
 */
export type ContributionConflict = {
  id: string;
  source: PluginSource;
  /** Ключи плагинов, претендующих на идентификатор. */
  plugins: string[];
};
