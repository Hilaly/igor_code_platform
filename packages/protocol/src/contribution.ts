/**
 * Вклад, зарегистрированный в реестре (docs/plugins.md), — то, чем плагин расширяет платформу. Реестр
 * живёт в демоне, а его результат уходит и в снимок состояния, и в события шины, поэтому форма
 * записи — контракт.
 *
 * Это не то, что объявил плагин: объявленное описывает SDK. Здесь — то, что ядро приняло, с
 * неймспейсом плагина в идентификаторе и с именем плагина рядом.
 */

import type { HookCriticality } from "./hook.ts";
import type { PluginSource } from "./plugin.ts";
import type { ThinkingLevel } from "./session.ts";
import type { AgentSkillSelection, AgentToolSelection } from "./tool-pattern.ts";

/**
 * Схема в виде данных — то, что отдаёт `z.toJSONSchema()`: нагрузка события и аргументы инструмента
 * описываются одинаково. Сама схема сюда попасть не может: в ней функции, а между воркером и ядром
 * ходит структурное клонирование (docs/event-bus.md).
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

/**
 * Инструмент, которым пользуется модель (docs/plugins.md). Аргументы описаны схемой-данными, как
 * нагрузка события: ручку инструмента собирает рантайм, а ядру она остаётся непрозрачной.
 *
 * **Имя, которым инструмент зовёт модель, — это `declaredId`**, а не отдельное поле: имена
 * инструментов у провайдеров ограничены `[A-Za-z0-9_-]`, поэтому неймспейс с точкой в имя не ставят,
 * а второе имя рядом с идентификатором было бы вторым способом сказать то же. Спор одноимённых
 * инструментов разных плагинов разрешает сборка набора (docs/hooks.md).
 *
 * Группы и порядка здесь нет: группой служит идентификатор плагина, а порядок внутри неё задаёт имя.
 */
export type ToolContributionRegistration = RegistrationCommon & {
  kind: "tool";
  /**
   * Что читает модель. Обязательно, в отличие от общего необязательного описания вклада: без
   * описания инструмент модели бесполезен.
   */
  description: string;
  parameters: PayloadSchema;
};

/**
 * Подписка на хук (docs/hooks.md). Порядка подписка не объявляет: он считается по рангу источника
 * плагина, затем по идентификатору вклада — иначе число, назначаемое автором себе сам, превратилось
 * бы в гонку.
 */
export type HookSubscriptionContributionRegistration = RegistrationCommon & {
  kind: "hook";
  /** Имя события Pi или хука платформы. Незнакомое отсеивается при регистрации. */
  event: string;
  criticality: HookCriticality;
};

/**
 * Методы, которыми плагин объявляет свой маршрут. Список тот же, что у таблицы маршрутов ядра: на
 * `OPTIONS` платформа не отвечает вовсе (docs/web-api.md), а `PATCH` не понадобился ни одному
 * маршруту ядра — вид сообщения появится вместе со своим потребителем.
 */
export const pluginRouteMethods = ["GET", "POST", "PUT", "DELETE"] as const;

export type PluginRouteMethod = (typeof pluginRouteMethods)[number];

export function isPluginRouteMethod(value: unknown): value is PluginRouteMethod {
  return pluginRouteMethods.includes(value as PluginRouteMethod);
}

/**
 * HTTP-маршрут плагина (docs/web-api.md). Адрес — `/p/<id плагина>/<path>`; идентификатор плагина, а
 * не его ключ: адрес попадает во внешние системы, и `project%3Ab7Kq%3Ahello` в вебхуке не наберёт
 * руками никто. Перекрытие при этом уже разрешено реестром — вклад один, победитель один.
 *
 * **`path` — не идентификатор вклада.** Идентификатором вклад переключается человеком и живёт в
 * `preferences.json`, а путь — часть внешнего адреса: связать их значило бы менять адрес при
 * переименовании вклада.
 *
 * Публичный маршрут — **отдельный вид**, а не флаг у обычного: разница между защищённым сессией и
 * открытым наружу маршрутом слишком велика для булева поля, которое легко скопировать из чужого
 * примера вместе со значением (docs/web-api.md, «Почему так»).
 */
type RouteRegistrationCommon = RegistrationCommon & {
  method: PluginRouteMethod;
  /** Без ведущего слэша, сегментами; сегмент вида `:имя` попадает в параметры запроса. */
  path: string;
};

export type RouteContributionRegistration = RouteRegistrationCommon & { kind: "route" };

export type PublicRouteContributionRegistration = RouteRegistrationCommon & {
  kind: "public-route";
};

export type ContributionRegistration =
  | CustomContributionRegistration
  | EventContributionRegistration
  | AgentContributionRegistration
  | SkillContributionRegistration
  | ToolContributionRegistration
  | HookSubscriptionContributionRegistration
  | RouteContributionRegistration
  | PublicRouteContributionRegistration;

export type ContributionKind = ContributionRegistration["kind"];

/**
 * Спор между вкладами с одинаковым идентификатором и одинаковым рангом источника: не применяется ни
 * один (docs/plugins.md). Претенденты — плагины или standalone-корни. Форма — контракт, потому что
 * спор уходит в снимок: диагностика обязана быть заметной в интерфейсе, а не строкой в журнале.
 */
export type ContributionConflict = {
  id: string;
  source: string;
  /** Ключи плагинов, претендующих на идентификатор. */
  plugins: string[];
  /** Ключи standalone-корней, претендующих на короткий идентификатор. */
  standaloneRoots?: string[];
};
