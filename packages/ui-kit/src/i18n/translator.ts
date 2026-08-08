/**
 * Перевод: ключ и подстановки на входе, строка на выходе. Отсутствующий перевод показывает базовую
 * строку **и** порождает диагностику (docs/ui-kit.md) — интерфейс от непереведённого ключа не ломается, но
 * расхождение локалей не копится молча.
 *
 * Диагностика уходит колбэком, а не в журнал: журнал живёт в демоне, а кит исполняется в браузере
 * (docs/logging.md).
 */

import { baseCatalogLocale, type Catalog, type CatalogRegistration } from "./catalog.ts";

export type MessageParameters = Record<string, string | number>;

export type ScopedTranslator = {
  /** Перевод по ключу внутри неймспейса. Ключ с подстановками `{name}` берёт их из `parameters`. */
  t: (key: string, parameters?: MessageParameters) => string;
  /**
   * Перевод, которого может законно не быть: у плагина есть право не переводить своё название, и
   * `t` на таком ключе вернул бы сам ключ и записал ложную диагностику о дырке в переводе.
   *
   * Дырку в **одной** локали при этом видно по-прежнему: если базовая строка есть, а перевода нет,
   * диагностика будет — молчание тут скрыло бы настоящее расхождение каталогов.
   */
  optional: (key: string, parameters?: MessageParameters) => string | undefined;
};

export type Translator = ScopedTranslator & {
  locale: string;
  /** Перевод в чужом неймспейсе: у плагина свой, и наши ключи в нём не лежат. */
  scope: (namespace: string) => ScopedTranslator;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date, options?: Intl.DateTimeFormatOptions) => string;
};

export type CreateTranslatorOptions = {
  locale: string;
  namespace: string;
  /**
   * Каталоги в порядке применения: последний побеждает по каждому сообщению отдельно. Так каталог
   * плагина для нашего неймспейса заменяет наши строки, а не весь набор целиком.
   */
  catalogs: CatalogRegistration[];
  /** Обязателен: проглоченная диагностика равна её отсутствию. */
  onDiagnostic: (diagnostic: string) => void;
};

export function createTranslator(options: CreateTranslatorOptions): Translator {
  const merged = new Map<string, Catalog>();

  for (const registration of options.catalogs) {
    const address = catalogAddress(registration.namespace, registration.locale);

    merged.set(address, { ...merged.get(address), ...registration.messages });
  }

  // Одна и та же дырка в переводе попадается на каждом рендере: без подавления повторов диагностика
  // превращается в поток, в котором ничего не видно.
  const reported = new Set<string>();
  const report = (diagnostic: string): void => {
    if (reported.has(diagnostic)) {
      return;
    }

    reported.add(diagnostic);
    options.onDiagnostic(diagnostic);
  };

  const plurals = new Intl.PluralRules(options.locale);
  const numbers = new Intl.NumberFormat(options.locale);

  const lookup = (namespace: string, key: string): string | undefined =>
    merged.get(catalogAddress(namespace, options.locale))?.[key];

  const lookupBase = (namespace: string, key: string): string | undefined =>
    merged.get(catalogAddress(namespace, baseCatalogLocale))?.[key];

  const optional = (
    namespace: string,
    key: string,
    parameters: MessageParameters | undefined,
  ): string | undefined => {
    // Множественная форма — отдельный ключ на категорию: `Intl` называет категорию, а какие из них
    // существуют в языке, знает язык, а не мы.
    const count = parameters?.["count"];
    const candidates = typeof count === "number" ? [`${key}.${plurals.select(count)}`, key] : [key];

    for (const candidate of candidates) {
      const message = lookup(namespace, candidate);

      if (message !== undefined) {
        return substitute(message, parameters, numbers, report);
      }
    }

    for (const candidate of candidates) {
      const base = lookupBase(namespace, candidate);

      if (base !== undefined) {
        report(`${namespace}:${options.locale} has no translation for ${key}`);

        return substitute(base, parameters, numbers, report);
      }
    }

    return undefined;
  };

  const scope = (namespace: string): ScopedTranslator => ({
    t: (key, parameters) => {
      const message = optional(namespace, key, parameters);

      if (message !== undefined) {
        return message;
      }

      report(`${namespace} has no message ${key} in any locale`);

      return key;
    },
    optional: (key, parameters) => optional(namespace, key, parameters),
  });

  return {
    locale: options.locale,
    ...scope(options.namespace),
    scope,
    formatNumber: (value, formatOptions) =>
      formatOptions === undefined
        ? numbers.format(value)
        : new Intl.NumberFormat(options.locale, formatOptions).format(value),
    formatDate: (value, formatOptions) =>
      new Intl.DateTimeFormat(options.locale, formatOptions).format(value),
  };
}

function catalogAddress(namespace: string, locale: string): string {
  return `${namespace}:${locale}`;
}

function substitute(
  message: string,
  parameters: MessageParameters | undefined,
  numbers: Intl.NumberFormat,
  report: (diagnostic: string) => void,
): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = parameters?.[name];

    if (value === undefined) {
      report(`the message ${JSON.stringify(message)} needs the parameter ${name}`);

      return placeholder;
    }

    // Числа идут через `Intl` и здесь: строка из шаблона не должна расходиться с числом, выведенным
    // отдельно.
    return typeof value === "number" ? numbers.format(value) : value;
  });
}
