/** Text state and numeric validation for independent configuration controls. */

import { configKeys, type Config } from "@sovereign/protocol";

export type ConfigText = Record<keyof Config, string>;

export function textOf(config: Config): ConfigText {
  return Object.fromEntries(configKeys.map((key) => [key, String(config[key])])) as ConfigText;
}

/** Empty and non-finite text must remain local; `Number("")` is misleadingly zero. */
export function parseFiniteNumber(text: string): number | undefined {
  const trimmed = text.trim();

  if (trimmed === "") {
    return undefined;
  }

  const value = Number(trimmed);

  return Number.isFinite(value) ? value : undefined;
}
