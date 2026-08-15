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

/**
 * Кто позвал инструмент. Набор собирается на каждый турн под конкретную сессию, и её идентичность
 * едет вместе с вызовом: иначе плагин, которому нужен обратный адрес — довести работу до вызвавшей
 * сессии, — не имеет его вовсе (docs/plugins.md).
 *
 * Каталог данных и таймаут вызова едут следом по той же причине: инструменту, который исполняет
 * команды (bash в starter-плагине), нужен каталог для временных файлов вывода и верхняя граница
 * foreground-команды, а ни того ни другого он не знает и узнать не может.
 */
export type PluginToolInvocation = {
  sessionId: string;
  projectId: string;
  /** Папка проекта: рабочая директория вызова. */
  folder: string;
  /**
   * Каталог данных платформы. Временные файлы инструментов кладутся в `<dataDirectory>/tmp`
   * (docs/bash-tool.md).
   */
  dataDirectory: string;
  /**
   * Таймаут вызова инструмента плагина (`pluginToolTimeoutMilliseconds` из `config.json`).
   * Foreground-команда bash обязана уложиться в него с запасом — дольше только background.
   */
  callTimeoutMilliseconds: number;
};

export type PluginToolInvoke<Arguments> = (
  toolArguments: Arguments,
  invocation: PluginToolInvocation,
) => PluginToolOutcome | Promise<PluginToolOutcome>;

const invocationsSymbol = Symbol.for("sovereign.plugin.tool.invocations");

type AnyToolInvoke = (toolArguments: never, invocation: PluginToolInvocation) => unknown;

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
  invocation: PluginToolInvocation,
): Promise<{ content: string; isError: boolean }> {
  const invoke = invocations().get(declaredId);

  if (invoke === undefined) {
    throw new Error(`the plugin has no implementation for the tool ${declaredId}`);
  }

  const outcome = await invoke(toolArguments as never, invocation);

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
