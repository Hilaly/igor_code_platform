/**
 * Формат сообщений между ядром и воркером плагина. Живёт в демоне, а не в протоколе и не в SDK:
 * это внутреннее устройство одной пары «бутстрап — супервизор», и обе стороны едут в одной сборке.
 * SDK при этом остаётся без зависимостей — он знает только интерфейс хоста.
 *
 * Сообщения односторонние, кроме одной пары. Ответа на `log`, `contribute` и `publish` нет: вклады
 * применяются одним снимком после `activate` (docs/ui-extension-model.md), а о проблеме плагин
 * узнаёт событием жизненного цикла, а не исключением на месте вызова (docs/plugins.md).
 *
 * Пара «запрос-ответ» здесь ровно одна — `request`/`response`, и она ограничена провайдерами
 * (docs/models-and-providers.md): список, статус и вход бессмысленны без ответа. Общего RPC из этого
 * не делается: вид запроса — закрытое объединение SDK, а не произвольное имя метода.
 */

import type {
  PluginContribution,
  PluginLogLevel,
  ProviderRequest,
  ProviderResponse,
} from "@sovereign/sdk";
import type { PluginEventOrigin, PluginSource } from "@sovereign/protocol";

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
  /** Имя объявленное: неймспейс ставит ядро по идентичности воркера (docs/event-bus.md). */
  | { kind: "publish"; declaredId: string; payload: unknown }
  /** Здесь имя, наоборот, полное: подписываются на чужое событие. */
  | { kind: "subscribe"; type: string }
  | { kind: "unsubscribe"; type: string }
  /** Запрос о провайдерах. `requestId` уникален внутри воркера — этого хватает: пара живёт в нём. */
  | { kind: "request"; requestId: string; request: ProviderRequest }
  | { kind: "activated" }
  /** Выгрузка завершена; `problem` заполнен, если `deactivate` бросил. */
  | { kind: "deactivated"; problem?: string }
  /** Импорт или `activate` не удались. Воркер после этого бесполезен и снимается ядром. */
  | { kind: "failed"; reason: string };

export type PluginIncoming =
  | { kind: "deactivate" }
  /** Событие с шины. `plugin` есть только у события плагина: у события ядра автора нет. */
  | { kind: "event"; type: string; payload: unknown; plugin?: PluginEventOrigin }
  /** Ответ на `request`, тем же `requestId`. */
  | { kind: "response"; requestId: string; response: ProviderResponse };
