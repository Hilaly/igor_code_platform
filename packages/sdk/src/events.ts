/**
 * Подписки плагина на события шины (ADR-0072). Обработчики держит SDK, а ядро знает
 * только имена: доставлять событие в воркер, где на него никто не подписан, незачем.
 *
 * Таблица живёт на символе в `globalThis` по той же причине, что и хэндл хоста: у внешнего плагина
 * в `node_modules` своя копия пакета, и таблица, заполненная копией плагина, для бутстрапа была бы
 * пустой ([runtime-checks.md](../../../docs/runtime-checks.md), проверка 15).
 */

import { currentPluginHost } from "./host.ts";

const handlersSymbol = Symbol.for("sovereign.plugin.event.handlers");

/** Кто опубликовал. У события ядра происхождения нет: его публикует платформа. */
export type EventOrigin = {
  key: string;
  id: string;
  source: string;
};

/**
 * Нагрузка приходит непрозрачной: чужой контракт мог измениться, и утверждать за подписчика её
 * форму платформа не будет. Типы берутся из дескриптора события, импортированного у публикатора.
 */
export type EventHandler = (payload: unknown, origin?: EventOrigin) => void | Promise<void>;

export type Unsubscribe = () => Promise<void>;

function handlers(): Map<string, Set<EventHandler>> {
  const existing = (globalThis as Record<symbol, unknown>)[handlersSymbol];

  if (existing !== undefined) {
    return existing as Map<string, Set<EventHandler>>;
  }

  const created = new Map<string, Set<EventHandler>>();
  (globalThis as Record<symbol, unknown>)[handlersSymbol] = created;

  return created;
}

/** Снимает все подписки этого воркера. Нужно тестовому шву: следующий тест начинается с чистого. */
export function clearEventHandlers(): void {
  delete (globalThis as Record<symbol, unknown>)[handlersSymbol];
}

/**
 * Подписка по точному имени, без масок: имя события — это контракт, а маска сделала бы контрактом
 * ещё и форму имён. Подписка на необъявленное событие ошибкой не является: публикатор бывает
 * выключен, а подписчик уже поднялся (ADR-0072).
 */
export async function subscribeToEvent(type: string, handler: EventHandler): Promise<Unsubscribe> {
  // Хост спрашивается первым: без него подписка не имеет смысла, а таблица осталась бы засорённой.
  const host = currentPluginHost();
  const table = handlers();
  const existing = table.get(type);

  if (existing === undefined) {
    table.set(type, new Set([handler]));

    // Ядро узнаёт об имени один раз: ему всё равно, сколько обработчиков внутри воркера.
    await host.subscribeEvent(type);
  } else {
    existing.add(handler);
  }

  let removed = false;

  return async () => {
    if (removed) {
      return;
    }

    removed = true;

    const set = handlers().get(type);
    set?.delete(handler);

    if (set !== undefined && set.size === 0) {
      handlers().delete(type);
      await currentPluginHost().unsubscribeEvent(type);
    }
  };
}

/**
 * Точка входа доставки: её зовёт бутстрап воркера, получив событие от ядра. Автору плагина она не
 * нужна.
 */
export async function deliverEvent(
  type: string,
  payload: unknown,
  origin?: EventOrigin,
): Promise<void> {
  for (const handler of [...(handlers().get(type) ?? [])]) {
    try {
      await handler(payload, origin);
    } catch (cause) {
      // Упавший обработчик не отменяет доставку остальным и не проглатывается: у плагина есть
      // журнал, и отказ его собственного кода — это запись в нём.
      await currentPluginHost().log("error", "the event handler failed", {
        event: type,
        reason: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
      });
    }
  }
}
