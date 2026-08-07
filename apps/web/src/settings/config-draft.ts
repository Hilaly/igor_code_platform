/**
 * Черновик формы конфига: правила без React, чтобы их можно было проверить прямо, а не через
 * отрисовку. Черновик хранит текст, а не значения, — браузер отдаёт строки, и «13» на полпути к
 * «130» числом ещё не является.
 */

import { configKeys, isLogLevel, type Config } from "@sovereign/protocol";

export type ConfigDraft = {
  /** Снимок, с которого начали правку: расхождение с ним — это правка человека. */
  base: Config;
  text: Record<keyof Config, string>;
};

export function draftOf(config: Config): ConfigDraft {
  return {
    base: config,
    text: Object.fromEntries(configKeys.map((key) => [key, String(config[key])])) as Record<
      keyof Config,
      string
    >,
  };
}

export function editDraft(draft: ConfigDraft, key: keyof Config, value: string): ConfigDraft {
  return { ...draft, text: { ...draft.text, [key]: value } };
}

export type DraftReading =
  | { kind: "read"; config: Config }
  /** Ключи, в которых стоит не число: отправить такое значит отправить `null` вместо значения. */
  | { kind: "unreadable"; unreadable: (keyof Config)[] };

/**
 * Разбор черновика. Правила значений здесь не повторяются — они живут в протоколе
 * (`parseConfigUpdate`), и второй их экземпляр в браузере разошёлся бы с первым молча: отказ придёт
 * от демона с точной причиной. Здесь ловится только то, что вообще не число, потому что такое поле
 * не пережило бы `JSON.stringify` — на сервер уехал бы `null`, а не введённое.
 */
export function readDraft(draft: ConfigDraft): DraftReading {
  const config: Config = { ...draft.base };
  const unreadable: (keyof Config)[] = [];

  for (const key of configKeys) {
    const raw = draft.text[key].trim();

    if (key === "logLevel") {
      if (isLogLevel(raw)) {
        config.logLevel = raw;
      } else {
        unreadable.push(key);
      }

      continue;
    }

    const value = Number(raw);

    // Пустая строка — это `Number("") === 0`, а не «ничего не введено»: без явной проверки очищенное
    // поле молча уехало бы нулём.
    if (raw === "" || !Number.isFinite(value)) {
      unreadable.push(key);

      continue;
    }

    config[key] = value;
  }

  return unreadable.length > 0 ? { kind: "unreadable", unreadable } : { kind: "read", config };
}

export function sameConfig(one: Config, other: Config): boolean {
  return configKeys.every((key) => one[key] === other[key]);
}

/**
 * Есть ли в черновике то, что потеряется, если принять снимок. Правка человека — это расхождение и
 * со снимком, с которого начали, и с тем, что демон говорит сейчас: собственная запись, доехавшая
 * обратно, совпадает со вторым, а нетронутое поле — с первым.
 */
export function hasUnsavedEdits(draft: ConfigDraft, config: Config): boolean {
  const reading = readDraft(draft);

  if (reading.kind === "unreadable") {
    return true;
  }

  return !sameConfig(reading.config, draft.base) && !sameConfig(reading.config, config);
}
