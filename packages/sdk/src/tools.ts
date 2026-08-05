/**
 * Инструменты, объявленные плагином (docs/plugins.md). Ручку инструмента собирает рантайм, а
 * реализация остаётся в воркере: ядру уходит объявление, вызов приходит обратно.
 *
 * Таблица живёт на символе в `globalThis` по той же причине, что таблицы подписок: у внешнего
 * плагина в `node_modules` своя копия пакета
 * ([runtime-checks.md](../../../docs/runtime-checks.md), проверка 15).
 */

/**
 * Что инструмент отдаёт модели. Текст, а не контент Pi: картинки и структурные детали инструмента
 * плагина в первую версию не входят — их пришлось бы протаскивать через границу воркера вместе с
 * контрактом контента Pi, а потребителя у них ещё нет.
 */
export type PluginToolOutcome = string | { content: string; isError?: boolean };

export type PluginToolInvoke<Arguments> = (
  toolArguments: Arguments,
) => PluginToolOutcome | Promise<PluginToolOutcome>;

const invocationsSymbol = Symbol.for("sovereign.plugin.tool.invocations");

type AnyToolInvoke = (toolArguments: never) => unknown;

function invocations(): Map<string, AnyToolInvoke> {
  const existing = (globalThis as Record<symbol, unknown>)[invocationsSymbol];

  if (existing !== undefined) {
    return existing as Map<string, AnyToolInvoke>;
  }

  const created = new Map<string, AnyToolInvoke>();
  (globalThis as Record<symbol, unknown>)[invocationsSymbol] = created;

  return created;
}

/** Нужно тестовому шву: следующий тест начинается с чистой таблицы. */
export function clearToolInvocations(): void {
  delete (globalThis as Record<symbol, unknown>)[invocationsSymbol];
}

export function rememberToolInvoke(declaredId: string, invoke: AnyToolInvoke): void {
  invocations().set(declaredId, invoke);
}

/**
 * Точка входа вызова: её зовёт бутстрап воркера, получив `call` от ядра. Аргументы приходят уже
 * проверенными схемой — их проверил рантайм по той же схеме, которую плагин объявил вкладом.
 */
export async function invokeTool(
  declaredId: string,
  toolArguments: unknown,
): Promise<{ content: string; isError: boolean }> {
  const invoke = invocations().get(declaredId);

  if (invoke === undefined) {
    throw new Error(`the plugin has no implementation for the tool ${declaredId}`);
  }

  const outcome = await invoke(toolArguments as never);

  if (typeof outcome === "string") {
    return { content: outcome, isError: false };
  }

  const shaped = outcome as { content?: unknown; isError?: unknown };

  if (typeof shaped.content !== "string") {
    throw new Error(`the tool ${declaredId} returned neither a string nor { content: string }`);
  }

  // Неудача инструмента — не сбой плагина: она уезжает признаком рядом с текстом, а не исключением.
  // Исключение означало бы, что вызвать инструмент не удалось вовсе.
  return { content: shaped.content, isError: shaped.isError === true };
}
