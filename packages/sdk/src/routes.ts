/**
 * HTTP-маршруты плагина (docs/web-api.md). Ядру уходит объявление — метод, путь и вид, — а
 * обработчик остаётся в воркере: через границу ходит структурное клонирование, а функция им не
 * переносится. Запрос приезжает обратным каналом вызова, тем же, которым работают хуки и
 * инструменты (docs/hooks.md).
 *
 * Таблица обработчиков живёт на символе в `globalThis` по той же причине, что таблицы подписок и
 * инструментов: у внешнего плагина в `node_modules` своя копия пакета
 * ([runtime-checks.md](../../../docs/runtime-checks.md), проверка 15).
 */

/** Копия списка из протокола, как и остальные типы SDK: внутренние пакеты в папку плагина не тянутся. */
export const pluginRouteMethods = ["GET", "POST", "PUT", "DELETE"] as const;

export type PluginRouteMethod = (typeof pluginRouteMethods)[number];

/**
 * Тело **буферизуется**: строка или байты. Потока здесь нет и не будет, пока граница воркера —
 * структурное клонирование; цена названа прямо в docs/web-api.md.
 */
export type PluginRouteBody = string | Uint8Array;

export type PluginRouteRequest = {
  method: PluginRouteMethod;
  /** Путь, каким его объявил вклад, а не адрес: префикс `/p/<id плагина>/` ставит платформа. */
  path: string;
  /** Значения сегментов вида `:имя` из объявленного пути. */
  parameters: Record<string, string>;
  /** Параметры строки запроса; повторяющееся имя оставляет последнее значение. */
  query: Record<string, string>;
  /** Заголовки как есть, именами в нижнем регистре: публичный маршрут аутентифицирует себя сам. */
  headers: Record<string, string>;
  body?: PluginRouteBody;
  /**
   * Пришёл ли запрос без сессии. У публичного маршрута — всегда `true`, и это напоминание автору:
   * вызывающего платформа не проверяла вовсе.
   */
  public: boolean;
};

export type PluginRouteResponse = {
  /** Не сказано — `200`; у ответа без тела разумно сказать `204`. */
  status?: number;
  headers?: Record<string, string>;
  body?: PluginRouteBody;
};

export type PluginRouteHandler = (
  request: PluginRouteRequest,
) => PluginRouteResponse | Promise<PluginRouteResponse>;

const handlersSymbol = Symbol.for("sovereign.plugin.route.handlers");

function handlers(): Map<string, PluginRouteHandler> {
  const existing = (globalThis as Record<symbol, unknown>)[handlersSymbol];

  if (existing !== undefined) {
    return existing as Map<string, PluginRouteHandler>;
  }

  const created = new Map<string, PluginRouteHandler>();
  (globalThis as Record<symbol, unknown>)[handlersSymbol] = created;

  return created;
}

/** Нужно тестовому шву: следующий тест начинается с чистой таблицы. */
export function clearRouteHandlers(): void {
  delete (globalThis as Record<symbol, unknown>)[handlersSymbol];
}

export function rememberRouteHandler(declaredId: string, handle: PluginRouteHandler): void {
  handlers().set(declaredId, handle);
}

/**
 * Точка входа вызова: её зовёт бутстрап воркера, получив `call` от ядра. Ответ проверяется здесь, у
 * автора, а не в демоне: демону негодный ответ виден только как `500`, а плагину — как своя ошибка.
 */
export async function invokeRoute(
  declaredId: string,
  request: PluginRouteRequest,
): Promise<PluginRouteResponse> {
  const handle = handlers().get(declaredId);

  if (handle === undefined) {
    throw new Error(`the plugin has no handler for the route ${declaredId}`);
  }

  const response = await handle(request);

  if (typeof response !== "object" || response === null) {
    throw new Error(`the route ${declaredId} answered with something that is not a response`);
  }

  return response;
}
