/**
 * Табличный диспетчер веб-API (docs/web-api.md): маршрут — это строка таблицы, а не ветка в `if`. Разбор
 * пути, чтение и лимит тела, коды и единая форма отказа живут здесь; обработчик занимается только
 * своим делом.
 *
 * Здесь же проверка сессии — одним местом на все маршруты, включая SSE-поток и будущие маршруты
 * плагинов (docs/authentication.md): маршрут чужого кода не может случайно оказаться незащищённым,
 * потому что защита не в обработчике.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "./logger.ts";

export type RouteParameters = Record<string, string>;

/** Кто спрашивает. Идентификатор записи сессии, а не токен: обработчику незачем видеть секрет. */
export type AuthenticatedSession = {
  id: string;
};

export type Authentication = ({ kind: "session" } & AuthenticatedSession) | { kind: "none" };

export type RequestContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  parameters: RouteParameters;
  /** Разобранное тело запроса. У запроса без тела — `undefined`. */
  body: unknown;
  /**
   * Сессия запроса. У защищённого маршрута она есть всегда — иначе обработчик не позвали бы; у
   * открытого её может не быть, и `GET /api/session` только этим и занимается.
   */
  session: AuthenticatedSession | undefined;
};

export type RouteHandler = (context: RequestContext) => void | Promise<void>;

export type Route = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Сегмент вида `:имя` попадает в `parameters`; остальные сравниваются буквально. */
  path: string;
  /**
   * `open` — маршрут отвечает и без сессии. Поле необязательное, и его отсутствие значит «нужна
   * сессия»: забытое поле делает новый маршрут защищённым, а не открытым.
   */
  access?: "open";
  handle: RouteHandler;
};

export type CreateDispatcherOptions = {
  routes: Route[];
  logger: Logger;
  /**
   * Проверка сессии. Поле обязательное, хотя открытых маршрутов хватило бы и без него: значение по
   * умолчанию здесь означало бы, что забытая проводка открывает API целиком и молча.
   */
  authenticate: (request: IncomingMessage) => Authentication;
  bodyLimitBytes?: number;
};

/**
 * Тела наших запросов — короткий json: включение плагина и список выключенных вкладов. Всё, что
 * больше, это ошибка клиента или попытка занять память демона, а не большой запрос.
 */
const defaultBodyLimitBytes = 64 * 1024;

export function respondWithJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);

  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

/** Единая форма отказа: клиенту незачем разбирать по коду, где json, а где страница ошибки. */
export function respondWithError(response: ServerResponse, status: number, error: string): void {
  respondWithJson(response, status, { error });
}

export function createDispatcher(
  options: CreateDispatcherOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const table = options.routes.map((route) => ({ route, pattern: segmentsOf(route.path) }));
  const bodyLimitBytes = options.bodyLimitBytes ?? defaultBodyLimitBytes;

  return (request, response) => {
    void handle(request, response);
  };

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // База нужна только конструктору URL: демон слушает петлю, и хост в запросе ни на что не влияет.
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const segments = segmentsOf(url.pathname);

    let matched: { route: Route; parameters: RouteParameters } | undefined;
    const allowed = new Set<string>();

    for (const { route, pattern } of table) {
      const parameters = matchRoute(pattern, segments);

      if (parameters === undefined) {
        continue;
      }

      allowed.add(route.method);

      if (route.method === request.method && matched === undefined) {
        matched = { route, parameters };
      }
    }

    if (matched === undefined) {
      // Путь есть, метод не тот — это не «нет такого адреса», и клиент имеет право знать разницу.
      if (allowed.size > 0) {
        response.setHeader("allow", [...allowed].join(", "));
        respondWithError(response, 405, `the method ${request.method} is not allowed here`);

        return;
      }

      respondWithError(response, 404, "not found");

      return;
    }

    // Форма запроса проверяется до сессии: ответ на негодный запрос не имеет права зависеть от
    // того, есть ли cookie, — иначе отказ рассказывал бы о состоянии входа.
    if (request.method !== "GET") {
      const refusal = refuseUnsafeRequest(request);

      if (refusal !== undefined) {
        respondWithError(response, refusal.status, refusal.error);

        return;
      }
    }

    // Проверка сессии — после разбора пути и до чтения тела. После разбора, потому что открытость
    // это свойство маршрута; до тела, потому что буферизовать килобайты для того, кто получит
    // отказ, незачем.
    const authentication = options.authenticate(request);
    const session = authentication.kind === "session" ? { id: authentication.id } : undefined;

    if (session === undefined && matched.route.access !== "open") {
      respondWithError(response, 401, "the request needs a session");

      return;
    }

    // У GET и DELETE тела нет по определению: читать его — значит ждать конца потока там, где
    // ждать нечего, а SSE-поток обязан начаться сразу.
    const body =
      request.method === "GET" || request.method === "DELETE"
        ? { kind: "absent" as const }
        : await readJsonBody(request, bodyLimitBytes);

    if (body.kind === "too-large") {
      respondWithError(response, 413, `the request body must not exceed ${bodyLimitBytes} bytes`);

      return;
    }

    if (body.kind === "invalid") {
      respondWithError(response, 400, `the request body is not valid json: ${body.reason}`);

      return;
    }

    try {
      await matched.route.handle({
        request,
        response,
        url,
        parameters: matched.parameters,
        body: body.kind === "parsed" ? body.value : undefined,
        session,
      });
    } catch (cause) {
      options.logger.error("the request handler failed", {
        method: request.method,
        path: url.pathname,
        reason: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
      });

      // Заголовки уже ушли — сказать про ошибку нечем, и оборванное соединение честнее, чем
      // молча оборванный на середине ответ, который клиент примет за полный.
      if (response.headersSent) {
        response.destroy();

        return;
      }

      respondWithError(response, 500, "internal error");
    }
  }
}

/**
 * Два замка на изменяющем запросе (docs/web-api.md). `SameSite=Strict` защищает всё, что за сессией:
 * межсайтовый запрос приходит без cookie и получает `401`. Но маршруты входа открыты по
 * необходимости, а чужая страница вправе отправить туда запрос, даже не имея права прочитать ответ, —
 * и на чистом демоне это значило бы, что пароль платформе назначает кто угодно.
 *
 * Первый замок — `Sec-Fetch-Site`: его ставит браузер, и страница его не подделает. Второй —
 * обязательный `application/json`: заголовка `Sec-Fetch-Site` нет у старых браузеров, а `text/plain`
 * делает запрос «простым», то есть он уходит вообще без предзапроса. С `application/json` предзапрос
 * обязателен, а мы на `OPTIONS` не отвечаем.
 *
 * Списка доверенных `Origin` при этом нет: он потребовал бы настройки — интерфейс приезжает то с
 * порта Vite, то из туннеля, — а защиты сверх этих двух проверок не добавил бы.
 */
function refuseUnsafeRequest(
  request: IncomingMessage,
): { status: number; error: string } | undefined {
  const site = request.headers["sec-fetch-site"];

  if (typeof site === "string" && site !== "same-origin") {
    return { status: 403, error: "a cross-site request cannot change anything here" };
  }

  // У `DELETE` тела нет по определению — требовать от него заголовок про тело незачем.
  if (request.method === "DELETE") {
    return undefined;
  }

  const type = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();

  return type === "application/json"
    ? undefined
    : { status: 415, error: "the request body must be application/json" };
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function matchRoute(pattern: string[], segments: string[]): RouteParameters | undefined {
  if (pattern.length !== segments.length) {
    return undefined;
  }

  const parameters: RouteParameters = {};

  for (const [index, expected] of pattern.entries()) {
    const actual = segments[index] ?? "";

    if (!expected.startsWith(":")) {
      if (expected !== actual) {
        return undefined;
      }

      continue;
    }

    const value = decodeSegment(actual);

    if (value === undefined) {
      return undefined;
    }

    parameters[expected.slice(1)] = value;
  }

  return parameters;
}

/** Кривая процентная последовательность — не совпадение с маршрутом, а не исключение в разборе. */
function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

type BodyOutcome =
  | { kind: "absent" }
  | { kind: "parsed"; value: unknown }
  | { kind: "too-large" }
  | { kind: "invalid"; reason: string };

async function readJsonBody(request: IncomingMessage, limitBytes: number): Promise<BodyOutcome> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    // Выход из цикла закрывает поток: слушать до конца то, что мы уже отказались принимать, — это
    // ровно та трата памяти, от которой защищает лимит.
    if (size > limitBytes) {
      return { kind: "too-large" };
    }

    chunks.push(chunk as Buffer);
  }

  if (size === 0) {
    return { kind: "absent" };
  }

  try {
    return { kind: "parsed", value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch (cause) {
    return { kind: "invalid", reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
