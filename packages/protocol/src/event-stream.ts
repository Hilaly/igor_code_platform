/**
 * Контракт потока событий (docs/web-api.md). Поток отдаёт то же, что публикуется на шине, но добавляет
 * своё: индекс и время. Индекс присваивает поток, а не публикатор, — по нему клиент говорит «я
 * дочитал до сих пор» и получает пропущенное при переподключении.
 */

import type { CoreEventPayloads, PluginEventOrigin } from "./events.ts";
import type { LoginStep } from "./provider-login.ts";

export const eventsPath = "/api/events";

/**
 * Позиция клиента в потоке. Браузерный `EventSource` присылает её заголовком `Last-Event-ID` сам;
 * параметр запроса — для всех остальных клиентов, которым заголовок ставить неоткуда.
 */
export const lastEventIdParameter = "lastEventId";

/**
 * Служебное сообщение: клиент назвал индекс, которого в окне уже нет, и пропущенного не существует.
 * Молча отдать огрызок нельзя — клиент считал бы своё состояние полным (docs/web-api.md).
 */
export const streamGapType = "core.stream.gap";

export type StreamGap = {
  /** Индекс, с которого клиент просил продолжить. */
  requestedIndex: number;
  /** Самый старый индекс, который поток ещё держит. Меньше него отдавать нечего. */
  oldestIndex: number;
};

export type StreamEventPayloads = CoreEventPayloads & {
  [streamGapType]: StreamGap;
};

export type StreamEventType = keyof StreamEventPayloads;

type StreamFrame = {
  /** Монотонный, начинается с единицы и сбрасывается при перезапуске демона. */
  index: number;
  /** Момент попадания в поток, ISO 8601. */
  time: string;
};

/** Кадр события ядра: тип определяет форму нагрузки. */
export type CoreStreamEvent = {
  [Type in StreamEventType]: StreamFrame & {
    type: Type;
    payload: StreamEventPayloads[Type];
  };
}[StreamEventType];

/**
 * Кадр события плагина. В поток он идёт наравне с событиями ядра, а не завёрнутым в них
 * (docs/web-api.md): для клиента это такое же событие, только имя пришло не из поставки.
 */
export type PluginStreamEvent = StreamFrame & {
  type: string;
  payload: unknown;
  plugin: PluginEventOrigin;
};

/**
 * Шаг интерактивного входа в провайдера (docs/models-and-providers.md).
 *
 * **Это не событие шины.** Событие шины — уведомление всем подписчикам, а шаг входа адресован
 * одному инициатору и ждёт ответа; запрос-ответ по шине запрещён (docs/event-bus.md). До плагина
 * шаг через шину не доходит: у попытки плагина шаги едут в его воркер.
 *
 * Соединением при этом пользуется тем же: второго SSE на вкладку в системе нет (docs/web-api.md).
 * Кадр нумеруется общей нумерацией и попадает в окно догона, но корректность на окно не опирается —
 * переподключившаяся вкладка перечитывает `GET /api/provider-logins`.
 */
export const loginStepFrameKind = "login-step";

export type LoginStepFrame = StreamFrame & {
  frame: typeof loginStepFrameKind;
  attemptId: string;
  providerId: string;
  step: LoginStep;
};

/**
 * Кадры, которые пришли с шины. Шаг входа сюда не входит по определению — он не событие шины, — и
 * это отдельный тип, а не комментарий: подписчик шины не должен уметь его получить.
 */
export type BusStreamEvent = CoreStreamEvent | PluginStreamEvent;

/** Кадр потока целиком: он же тело `data:`, разбирать SSE-поля клиенту не нужно. */
export type StreamEvent = BusStreamEvent | LoginStepFrame;

/**
 * Различает кадры так же, как шина различает события, — по наличию `plugin`. Без этого имя
 * события ядра перестаёт сужать нагрузку: у события плагина имя произвольное.
 */
export function isPluginStreamEvent(event: BusStreamEvent): event is PluginStreamEvent {
  return "plugin" in event;
}

/**
 * Кадр шага входа различается наличием `frame` — тем же приёмом, что и кадр плагина. Поля `frame`
 * нет ни у одного кадра события, поэтому охранники исключают друг друга, и это под тестом: разойдись
 * они, шаг входа приехал бы подписчику на события как событие с пустой нагрузкой.
 */
export function isLoginStepFrame(event: StreamEvent): event is LoginStepFrame {
  return "frame" in event;
}
