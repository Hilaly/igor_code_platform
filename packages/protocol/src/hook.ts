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
 */
export const platformHookMergeKinds = {
  tools_collect: "collecting",
  session_created: "observing",
  session_closed: "observing",
  before_session_start: "deciding",
  turn_finished: "observing",
  /**
   * Запрос разрешения на вызов инструмента. Назван своим именем, а не сведён с `tool_call` Pi: у
   * события Pi нет ни сессии, ни проекта, а без них политика разрешений неотличима от глобальной.
   * Ядро диалог с человеком не проксирует — его делает плагин (docs/hooks.md).
   */
  permission_request: "deciding",
} as const satisfies Record<string, HookMergeKind>;

export type PlatformHookName = keyof typeof platformHookMergeKinds;

export const platformHookNames = Object.keys(platformHookMergeKinds) as PlatformHookName[];

export function isPlatformHookName(value: unknown): value is PlatformHookName {
  return typeof value === "string" && value in platformHookMergeKinds;
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
