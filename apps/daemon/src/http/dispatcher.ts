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

import type { Logger } from "../platform/public.ts";

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
   * открытого её может не быть, и `GET /api/login-session` только этим и занимается.
   */
  session: AuthenticatedSession | undefined;
};

export type RouteHandler = (context: RequestContext) => void | Promise<void>;

export type Route = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Сегмент вида `:имя` попадает в `parameters`; остальные сравниваются буквально. */
  path: string;
  /**
   * Кому маршрут отвечает. Поле необязательное, и его отсутствие значит «нужна сессия»: забытое
   * поле делает новый маршрут защищённым, а не открытым.
   *
   * - `open` — маршрут ядра, отвечающий и без сессии: состояние входа, вход, регистрация и проба
   *   здоровья. Проверки формы изменяющего запроса он проходит наравне с остальными — ровно на них
   *   и держится защита открытых маршрутов от межсайтового запроса (docs/web-api.md).
   * - `public` — публичный маршрут плагина, открытый **наружу**. Ни сессии, ни проверок формы: у
   *   него нет cookie, которую эти проверки защищают, а `content-type` вызывающего ему не
   *   принадлежит. Аутентифицирует себя такой маршрут сам (docs/web-api.md).
   */
  access?: "open" | "public";
  /**
   * Свой предел тела. Не сказано — общий: тела наших запросов короткие, а вебхук приносит чужие.
   *
   * Функция спрашивается на каждый запрос: предел бывает вычислен из `config.json`, а он
   * перечитывается на живом демоне, и число, снятое при сборке таблицы, устарело бы молча.
   */
  bodyLimitBytes?: number | (() => number);
  /** Предельное время чтения тела; после него соединение закрывается, чтобы поток не держал демон. */
  bodyReadTimeoutMilliseconds?: number;
  /** `raw` отдаёт тело буфером, не разбирая его как json: форму тела знает только автор маршрута. */
  body?: "json" | "raw";
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
  /**
   * Второй источник строк таблицы — маршруты плагинов (docs/web-api.md). Функция, а не массив:
   * набор меняется при каждой перезагрузке любого плагина, а регистрация и снятие строк в живой
   * таблице — это ровно та ошибка, из-за которой отвергнут Hono: устаревший обработчик, который
   * продолжает отвечать.
   */
  pluginRoutes?: () => Route[];
};

/**
 * Тела наших запросов — короткий json: включение плагина и список выключенных вкладов. Всё, что
 * больше, это ошибка клиента или попытка занять память демона, а не большой запрос.
 */
const defaultBodyLimitBytes = 64 * 1024;
const defaultBodyReadTimeoutMilliseconds = 30_000;

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
  const table = options.routes.map((route, order) => tableRow(route, order));
  const bodyLimitBytes = options.bodyLimitBytes ?? defaultBodyLimitBytes;
  // Таблица плагинов пересчитывается на каждый запрос: разбор пути — это `split`, а живой снимок
  // важнее экономии на нём.
  const pluginTable = (): TableRow[] =>
    (options.pluginRoutes?.() ?? []).map((route, order) => tableRow(route, table.length + order));

  return (request, response) => {
    void handle(request, response).catch((cause: unknown) => {
      options.logger.error("request handling failed", {
        method: request.method,
        path: request.url ?? "/",
        reason: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
      });

      if (request.destroyed || response.destroyed || response.headersSent) {
        if (!response.destroyed && !response.headersSent) {
          response.destroy();
        }

        return;
      }

      respondWithError(response, 400, "the request could not be read");
    });
  };

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // База нужна только конструктору URL: демон слушает петлю, и хост в запросе ни на что не влияет.
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const segments = segmentsOf(url.pathname);

    const matches: {
      route: Route;
      parameters: RouteParameters;
      specificity: number;
      order: number;
    }[] = [];
    const allowed = new Set<string>();

    for (const { route, pattern, order } of [...table, ...pluginTable()]) {
      const parameters = matchRoute(pattern, segments);

      if (parameters === undefined) {
        continue;
      }

      allowed.add(route.method);

      matches.push({ route, parameters, specificity: staticSegments(pattern), order });
    }

    const matched = matches
      .filter(({ route }) => route.method === request.method)
      .sort((left, right) => right.specificity - left.specificity || left.order - right.order)[0];

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
    // того, есть ли cookie, — иначе отказ рассказывал бы о состоянии входа. Публичный маршрут
    // плагина её не проходит вовсе: защищать ею нечего, а отсекла бы она чужой вебхук.
    if (request.method !== "GET" && matched.route.access !== "public") {
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

    if (session === undefined && matched.route.access === undefined) {
      respondWithError(response, 401, "the request needs a session");

      return;
    }

    // У GET и DELETE тела нет по определению: читать его — значит ждать конца потока там, где
    // ждать нечего, а SSE-поток обязан начаться сразу.
    const routeLimit = matched.route.bodyLimitBytes;
    const limitBytes =
      (typeof routeLimit === "function" ? routeLimit() : routeLimit) ?? bodyLimitBytes;
    const body =
      request.method === "GET" || request.method === "DELETE"
        ? { kind: "absent" as const }
        : await readBody(
            request,
            response,
            limitBytes,
            matched.route,
            matched.route.bodyReadTimeoutMilliseconds ?? defaultBodyReadTimeoutMilliseconds,
          );

    if (body.kind === "too-large") {
      respondWithError(
        response,
        413,
        `the request body must not exceed ${String(limitBytes)} bytes`,
      );

      return;
    }

    if (body.kind === "timed-out") {
      if (!request.destroyed && !response.destroyed) {
        respondWithError(response, 408, "the request body took too long to arrive");
      }

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

type TableRow = { route: Route; pattern: string[]; order: number };

function tableRow(route: Route, order: number): TableRow {
  return { route, pattern: segmentsOf(route.path), order };
}

function staticSegments(pattern: string[]): number {
  return pattern.filter((segment) => !segment.startsWith(":")).length;
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
  | { kind: "timed-out" }
  | { kind: "invalid"; reason: string };

/**
 * Тело маршрута ядра — всегда json, и негодный json это `400`. Тело маршрута плагина, наоборот, не
 * разбирается вовсе: его форму знает только автор маршрута, а вебхук приносит что угодно —
 * подписанный текст, форму, байты (docs/web-api.md).
 */
async function readBody(
  request: IncomingMessage,
  response: ServerResponse,
  limitBytes: number,
  route: Route,
  timeoutMilliseconds: number,
): Promise<BodyOutcome> {
  const chunks: Buffer[] = [];
  let size = 0;
  let timedOut = false;
  const timeout =
    timeoutMilliseconds > 0
      ? setTimeout(() => {
          timedOut = true;
          if (!response.destroyed && !response.headersSent) {
            respondWithError(response, 408, "the request body took too long to arrive");
          }
          request.destroy();
        }, timeoutMilliseconds)
      : undefined;

  timeout?.unref();

  try {
    for await (const chunk of request) {
      size += chunk.length;

      // Выход из цикла закрывает поток: слушать до конца то, что мы уже отказались принимать, — это
      // ровно та трата памяти, от которой защищает лимит.
      if (size > limitBytes) {
        return { kind: "too-large" };
      }

      chunks.push(chunk as Buffer);
    }

    if (timedOut) {
      return { kind: "timed-out" };
    }
  } catch (cause) {
    if (timedOut) {
      return { kind: "timed-out" };
    }

    throw cause;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }

  if (size === 0) {
    return { kind: "absent" };
  }

  const body = Buffer.concat(chunks);

  if (route.body === "raw") {
    return { kind: "parsed", value: body };
  }

  try {
    return { kind: "parsed", value: JSON.parse(body.toString("utf8")) };
  } catch (cause) {
    return { kind: "invalid", reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
