/**
 * Жизненный цикл плагина (docs/plugins.md) как контракт, а не как внутреннее дело супервизора:
 * этими же словами о плагине говорят журнал, снимок состояния и события шины. Расхождение между
 * ними — не мелочь: человек, увидевший в потоке `running`, а в снимке `starting`, перестаёт верить
 * обоим.
 */

import type { PluginSource } from "./plugin.ts";

/** Порядок перечисления смысловой нагрузки не несёт: переходы между состояниями задаёт docs/plugins.md. */
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
  /**
   * Почему объявленный вклад не появился: кривой идентификатор, занятый неймспейс ядра, двойное
   * объявление (docs/plugins.md). Поле в статусе, а не в снимке, потому что статус ходит и потоком, а для
   * пользователя это единственный признак, что вклада нет.
   */
  contributionProblems?: string[];
};
