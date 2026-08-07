/**
 * Формат сообщений между ядром и воркером плагина. Живёт в демоне, а не в протоколе и не в SDK:
 * это внутреннее устройство одной пары «бутстрап — супервизор», и обе стороны едут в одной сборке.
 * SDK при этом остаётся без зависимостей — он знает только интерфейс хоста.
 *
 * Сообщения односторонние, кроме одной пары. Ответа на `log`, `contribute` и `publish` нет: вклады
 * применяются одним снимком после `activate` (docs/ui-extension-model.md), а о проблеме плагин
 * узнаёт событием жизненного цикла, а не исключением на месте вызова (docs/plugins.md).
 *
 * Пар «запрос-ответ» здесь две, и они направлены в разные стороны. `request`/`response` идёт от
 * воркера к ядру, и видов запроса в ней три: провайдеры, сессии и хранилище плагина
 * (docs/models-and-providers.md, docs/plugins.md) — все три бессмысленны без ответа.
 * `call`/`call-result` идёт от ядра к воркеру: хук, инструмент и маршрут плагина — это ядро,
 * которое зовёт чужой код и **ждёт значение** (docs/hooks.md, docs/web-api.md).
 *
 * Общего RPC ни из той, ни из другой не делается: вид запроса и вид вызова — закрытые объединения, а
 * не произвольное имя метода.
 */

import type {
  LoginStep,
  PluginContribution,
  PluginLogLevel,
  PluginRouteKind,
  PluginRouteRequest,
  ProviderRequest,
  ProviderResponse,
  SessionRequest,
  SessionResponse,
  StorageRequest,
  StorageResponse,
} from "@sovereign/sdk";
import type { PluginEventOrigin, PluginSource } from "@sovereign/protocol";

export type PluginWorkerData = {
  id: string;
  source: PluginSource;
  directory: string;
  /** Абсолютный путь к точке входа: резолвить манифест воркеру незачем. */
  workerEntry: string;
};

/** Все три вида запроса в направлении «воркер спрашивает ядро» (docs/plugins.md). */
export type PluginRequest = ProviderRequest | SessionRequest | StorageRequest;

export type PluginResponse = ProviderResponse | SessionResponse | StorageResponse;

/**
 * Что ядро зовёт у плагина. Вид закрыт: общего RPC из пары не делается, произвольного имени метода
 * в воркере нет. Идентификатор вклада — единственный адрес: им же ключуется таблица обработчиков в
 * воркере, и им же человек включает и выключает вклад (docs/hooks.md).
 */
export type PluginCall =
  | { kind: "hook"; contributionId: string; event: string; payload: unknown }
  | { kind: "tool"; contributionId: string; arguments: unknown }
  | {
      kind: "route";
      routeKind: PluginRouteKind;
      contributionId: string;
      request: PluginRouteRequest;
    };

/**
 * Чем плагин отвечает на вызов. Отказ и сбой разведены: отказ решающего хука — это исход по делу,
 * который ядро несёт человеку с автором и причиной, а сбой означает, что вызвать не удалось вовсе.
 * Оба доезжают значением, а не исключением: исключение из хука роняет турн Pi (docs/hooks.md).
 */
export type PluginCallResult =
  /** Форму значения задаёт вид вызова: у маршрута это `PluginRouteResponse`, у инструмента — исход. */
  | { kind: "value"; value: unknown }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string };

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
   * Видов запроса три — провайдеры, сессии и хранилище, — и все ходят одним видом сообщения: второй
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
  /**
   * Ответ на `call`, тем же `callId`. Обработчик, бросивший исключение, приезжает сюда сбоем: до Pi
   * исключению доходить нельзя, там оно роняет турн (docs/hooks.md).
   */
  | { kind: "call-result"; callId: string; result: PluginCallResult }
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
  /**
   * Вызов от ядра. `callId` — **демонский** и отдельный от воркерского `requestId`: пары идут в
   * разные стороны, и общего пространства номеров у них нет. Ждать ответа и снимать ожидание по
   * таймауту — работа демона: воркер с зависшим обработчиком о том, что он зависший, сообщить не
   * может по определению (docs/hooks.md).
   */
  | { kind: "call"; callId: string; call: PluginCall }
  /** Вопрос или сообщение по ходу входа. Конец диалога приезжает ответом, а не шагом. */
  | { kind: "login-step"; requestId: string; step: LoginStep };

/** Что плагин говорит в ответ на шаг входа. Супервизор это только маршрутизирует. */
export type PluginLoginReply = Extract<PluginOutgoing, { kind: "login-answer" | "login-cancel" }>;
