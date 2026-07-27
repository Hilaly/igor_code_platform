/**
 * Плагин, написанный на синтаксисе, который платформе запрещён: `enum` и parameter properties.
 * Он проверяет, что воркер получает `--experimental-transform-types` (ADR-0004, проверка 4), —
 * без флага этот файл не запустится вовсе.
 */

import { log, type PluginModule } from "@sovereign/sdk";

enum Mood {
  Calm,
  Loud,
}

class Greeter {
  constructor(private readonly mood: Mood) {}

  greeting(): string {
    return this.mood === Mood.Loud ? "TYPESCRIPTY IS UP" : "typescripty is up";
  }
}

export const activate: PluginModule["activate"] = async () => {
  await log.info(new Greeter(Mood.Loud).greeting());
};
