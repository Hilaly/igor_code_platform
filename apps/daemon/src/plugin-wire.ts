/**
 * Формат сообщений между ядром и воркером плагина. Живёт в демоне, а не в протоколе и не в SDK:
 * это внутреннее устройство одной пары «бутстрап — супервизор», и обе стороны едут в одной сборке.
 * SDK при этом остаётся без зависимостей — он знает только интерфейс хоста.
 *
 * Сообщения односторонние. Ответа на `log`, `contribute` и `publish` нет: вклады применяются одним
 * снимком после `activate` (ADR-0024), а о проблеме плагин узнаёт событием жизненного цикла, а не
 * исключением на месте вызова (ADR-0054).
 */

import type { PluginContribution, PluginLogLevel } from "@sovereign/sdk";
import type { PluginSource } from "@sovereign/protocol";

export type PluginWorkerData = {
  id: string;
  source: PluginSource;
  directory: string;
  /** Абсолютный путь к точке входа: резолвить манифест воркеру незачем. */
  workerEntry: string;
};

export type PluginOutgoing =
  | {
      kind: "log";
      level: PluginLogLevel;
      message: string;
      fields?: Record<string, unknown>;
    }
  | { kind: "contribute"; contribution: PluginContribution }
  /** Имя объявленное: неймспейс ставит ядро по идентичности воркера (ADR-0072). */
  | { kind: "publish"; declaredId: string; payload: unknown }
  | { kind: "activated" }
  /** Выгрузка завершена; `problem` заполнен, если `deactivate` бросил. */
  | { kind: "deactivated"; problem?: string }
  /** Импорт или `activate` не удались. Воркер после этого бесполезен и снимается ядром. */
  | { kind: "failed"; reason: string };

export type PluginIncoming = { kind: "deactivate" };
