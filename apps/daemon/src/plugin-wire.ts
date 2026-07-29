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
  LoginStep,
  PluginContribution,
  PluginLogLevel,
  ProviderRequest,
  ProviderResponse,
  SessionRequest,
  SessionResponse,
} from "@sovereign/sdk";
import type { PluginEventOrigin, PluginSource } from "@sovereign/protocol";

export type PluginWorkerData = {
  id: string;
  source: PluginSource;
  directory: string;
  /** Абсолютный путь к точке входа: резолвить манифест воркеру незачем. */
  workerEntry: string;
};

/** Оба канала «запрос-ответ» в канале плагина (docs/plugins.md). */
export type PluginRequest = ProviderRequest | SessionRequest;

export type PluginResponse = ProviderResponse | SessionResponse;

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
  /**
   * Запрос к платформе. `requestId` уникален внутри воркера — этого хватает: пара живёт в нём.
   * Каналов запроса-ответа два, провайдеры и сессии, и оба ходят одним видом сообщения: второй
   * счётчик идентификаторов на один воркер сломал бы сопоставление ответа с вызовом.
   */
  | { kind: "request"; requestId: string; request: PluginRequest }
  /**
   * Ответ на вопрос входа. Ключуется `requestId` **самого вызова `login`**, а не попытки: шаги —
   * часть контракта операции, а не отдельный поток (docs/models-and-providers.md).
   */
  | { kind: "login-answer"; requestId: string; stepId: string; value: string }
  /** Отмена входа: плагин отказался отвечать. Отличается от отказа провайдера, и это видно в конце. */
  | { kind: "login-cancel"; requestId: string }
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
  | { kind: "response"; requestId: string; response: PluginResponse }
  /** Вопрос или сообщение по ходу входа. Конец диалога приезжает ответом, а не шагом. */
  | { kind: "login-step"; requestId: string; step: LoginStep };

/** Что плагин говорит в ответ на шаг входа. Супервизор это только маршрутизирует. */
export type PluginLoginReply = Extract<PluginOutgoing, { kind: "login-answer" | "login-cancel" }>;
