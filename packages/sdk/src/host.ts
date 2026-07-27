/**
 * Хэндл хоста: то, через что `@sovereign/sdk` разговаривает с платформой. Ставит его бутстрап
 * воркера до импорта кода плагина (ADR-0043), а в тестах — шов из `@sovereign/sdk/testing`.
 * Авторам плагинов эта точка входа не нужна.
 *
 * Хэндл живёт на символе в `globalThis`, а не в переменной модуля, потому что модуля бывает два:
 * у внешнего плагина в `node_modules` лежит своя копия пакета, и состояние, записанное в копию
 * бутстрапа, до плагина не дойдёт ([runtime-checks.md](../../../docs/runtime-checks.md),
 * проверка 15). У воркера свой `globalThis`, поэтому чужой плагин к чужому хосту не дотянется.
 */

const hostSymbol = Symbol.for("sovereign.plugin.host");

/**
 * Уровни повторяют журнал платформы. Дубль намеренный: SDK ставится извне и не тянет за собой
 * внутренние пакеты — иначе публикуемая поверхность потянет за собой весь протокол.
 */
export type PluginLogLevel = "debug" | "info" | "warn" | "error";

/** Кто мы. Приходит от хоста: сам себя плагин не называет (ADR-0021). */
export type PluginIdentity = {
  id: string;
  source: string;
};

/**
 * Общий вид вклада (ADR-0054): идентификатор, метаданные отображения, произвольная нагрузка.
 * Типизированные виды появятся вместе со своими потребителями.
 */
export type CustomContribution = {
  /** Без неймспейса: его добавляет хост, объявить чужой нельзя (ADR-0024, ADR-0060). */
  id: string;
  title?: string;
  description?: string;
  payload?: unknown;
};

export type PluginHost = {
  identity: PluginIdentity;
  log: (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => Promise<void>;
  contribute: (contribution: CustomContribution) => Promise<void>;
};

export function installPluginHost(host: PluginHost): void {
  (globalThis as Record<symbol, unknown>)[hostSymbol] = host;
}

export function removePluginHost(): void {
  delete (globalThis as Record<symbol, unknown>)[hostSymbol];
}

/**
 * Ошибка вместо падения по `undefined`: SDK, вызванный вне воркера плагина, обязан объяснить,
 * что произошло (ADR-0043) — иначе автор увидит «cannot read property of undefined».
 */
export function currentPluginHost(): PluginHost {
  const host = (globalThis as Record<symbol, unknown>)[hostSymbol];

  if (host === undefined) {
    throw new Error(
      "The sovereign sdk is not initialised: it works inside a plugin worker started by the " +
        "platform. In tests install the seam from @sovereign/sdk/testing before importing the plugin.",
    );
  }

  return host as PluginHost;
}
