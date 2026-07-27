/**
 * Жизненный цикл плагина (ADR-0018, ADR-0070) как контракт, а не как внутреннее дело супервизора:
 * этими же словами о плагине говорят журнал, снимок состояния и события шины. Расхождение между
 * ними — не мелочь: человек, увидевший в потоке `running`, а в снимке `starting`, перестаёт верить
 * обоим.
 */

import type { PluginSource } from "./plugin.ts";

/** Порядок перечисления смысловой нагрузки не несёт: переходы между состояниями задаёт ADR-0070. */
export const pluginLifecycleStates = [
  "discovered",
  "disabled",
  "refused",
  "installing",
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
] as const;

export type PluginLifecycleState = (typeof pluginLifecycleStates)[number];

export type PluginStatus = {
  /** `<источник>:<id>`; у плагина, отказанного до чтения манифеста, идентификатора нет. */
  key: string;
  id?: string;
  source: PluginSource;
  directory: string;
  state: PluginLifecycleState;
  /** Почему отказано или почему упал. У штатных состояний причины нет. */
  reason?: string;
  /** Номер неудачной попытки и момент следующей: перезапуск наблюдаем, а не угадывается. */
  attempt?: number;
  nextAttemptAt?: number;
};
