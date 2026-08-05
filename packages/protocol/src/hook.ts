/**
 * Хуки: то, чего у Pi нет по определению (docs/hooks.md). Имена и формы 32 событий рантайма здесь не
 * переописываются — они берутся у Pi как есть, и своих зеркальных типов мы не заводим. Протокол
 * объявляет ровно три вещи: хуки платформы, критичность подписки и форму отказа.
 */

/**
 * Как сводятся ответы нескольких подписчиков (docs/hooks.md). Вид задан хуком, а не подпиской: два
 * плагина на одном событии не могут сводиться по разным правилам.
 */
export const hookMergeKinds = ["observing", "collecting", "deciding", "rewriting"] as const;

export type HookMergeKind = (typeof hookMergeKinds)[number];

/**
 * Хуков платформы пять, а имён шесть: создание и закрытие сессии — один хук жизненного цикла с двумя
 * точками вызова (docs/hooks.md).
 *
 * `subscribable` отделяет точку, которой плагин пользуется подпиской, от точки, которой он
 * пользуется вкладом. Собирающий `tools_collect` подписке не отдаётся: инструмент объявляется
 * вкладом `tool`, и каждый включённый вклад становится источником внутри этого хука. Подписка,
 * возвращающая инструменты, была бы вторым способом добавить инструмент — и притом способом, который
 * нельзя выключить отдельно, хотя вклад выключить можно (docs/plugins.md).
 */
export const platformHooks = {
  tools_collect: { merge: "collecting", subscribable: false },
  session_created: { merge: "observing", subscribable: true },
  session_closed: { merge: "observing", subscribable: true },
  before_session_start: { merge: "deciding", subscribable: true },
  turn_finished: { merge: "observing", subscribable: true },
  /**
   * Запрос разрешения на вызов инструмента. Назван своим именем, а не сведён с `tool_call` Pi: у
   * события Pi нет ни сессии, ни проекта, а без них политика разрешений неотличима от глобальной.
   * Ядро диалог с человеком не проксирует — его делает плагин (docs/hooks.md).
   */
  permission_request: { merge: "deciding", subscribable: true },
} as const satisfies Record<string, { merge: HookMergeKind; subscribable: boolean }>;

export type PlatformHookName = keyof typeof platformHooks;

export const platformHookNames = Object.keys(platformHooks) as PlatformHookName[];

export function isPlatformHookName(value: unknown): value is PlatformHookName {
  return typeof value === "string" && value in platformHooks;
}

/** На что плагин вправе подписаться. Остальное платформа зовёт сама. */
export function isSubscribablePlatformHook(value: unknown): value is PlatformHookName {
  return isPlatformHookName(value) && platformHooks[value].subscribable;
}

/**
 * Насколько подписка обязательна. Одна пометка, но исход у неё разный по виду хука: матрица — в
 * docs/hooks.md. Объявляет её подписка, а не платформа: платформа не знает, что для плагина важно.
 */
export const hookCriticalities = ["advisory", "critical"] as const;

export type HookCriticality = (typeof hookCriticalities)[number];

export function isHookCriticality(value: unknown): value is HookCriticality {
  return hookCriticalities.includes(value as HookCriticality);
}

/**
 * Отказ решающего хука (docs/hooks.md). Отказ — исход, а не исключение: запрет политикой означает,
 * что система работает как задумано.
 */
export type HookRefusal = {
  /**
   * Автор — идентификатор **вклада**, а не плагина: подписок у плагина бывает несколько, и выключать
   * придётся конкретную.
   */
  contributionId: string;
  /** Текст плагина, попадает в интерфейс как есть. Таймаут приходит отказом этой же формы. */
  reason: string;
};
