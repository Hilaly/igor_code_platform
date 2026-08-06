/**
 * HTTP-маршруты плагинов (docs/web-api.md): второй источник строк табличного диспетчера. Строка у
 * маршрута плагина та же, что у маршрута ядра, — разбор пути, коды `404`/`405` и проверка сессии
 * остаются в диспетчере, потому что маршрут чужого кода не имеет права оказаться незащищённым
 * случайно.
 *
 * Обработчик исполняется в воркере: запрос уезжает обратным каналом вызова, тем же, которым
 * работают хуки и инструменты (docs/hooks.md). Своего порта плагин не открывает.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { ContributionRegistration } from "@sovereign/protocol";
import type { PluginRouteRequest, PluginRouteResponse } from "@sovereign/sdk";

import type { ContributionRegistry } from "./contribution-registry.ts";
import { respondWithError, type Route } from "../http/public.ts";
import type { Logger } from "../platform/public.ts";
import type { PluginSupervisor } from "./plugin-supervisor.ts";

type RouteRegistration = Extract<
  ContributionRegistration,
  { kind: "route" | "public-route"; ownership: "plugin" }
>;

export type PluginRoutes = {
  /**
   * Действующие маршруты. Пересобираются, когда изменилась ревизия реестра: набор меняется при
   * каждой перезагрузке любого плагина, а спор за адрес обязан попасть в журнал один раз, а не на
   * каждый запрос.
   */
  routes: () => Route[];
};

export type CreatePluginRoutesOptions = {
  registry: ContributionRegistry;
  /** Кого зовём. Нужен только `call`: поднимать и гасить плагины маршруты не имеют права. */
  plugins: Pick<PluginSupervisor, "call">;
  logger: Logger;
  /** Ключи `config.json`, читаются живьём — как остальные (docs/data-directory.md). */
  timeoutMilliseconds: () => number;
  bodyLimitBytes: () => number;
  requestsPerMinute: () => number;
  now?: () => number;
};

/** Заголовки, которыми распоряжается сервер: плагин, переписавший их, оборвал бы ответ на середине. */
const reservedHeaders = new Set([
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

export function createPluginRoutes(options: CreatePluginRoutesOptions): PluginRoutes {
  const { registry, plugins, logger } = options;
  const now = options.now ?? (() => Date.now());

  /** Окна лимита частоты по паре «вклад + адрес вызывающего» (docs/web-api.md). */
  const windows = new Map<string, { startedAt: number; count: number }>();

  let built: { revision: number; bodyLimitBytes: number; routes: Route[] } | undefined;

  const callerOf = (request: IncomingMessage): string =>
    request.socket.remoteAddress ?? "unknown caller";

  /**
   * Лимит частоты — часть механизма, а не пожелание: иначе один публичный маршрут превращает демон
   * в мишень. Окно фиксированное и минутное; считается по вкладу и адресу, чтобы чужой вебхук не
   * закрывал доступ соседнему.
   */
  const withinLimit = (key: string): boolean => {
    const limit = options.requestsPerMinute();
    const moment = now();
    const window = windows.get(key);

    if (window === undefined || moment - window.startedAt >= 60_000) {
      // Уборка идёт здесь же: отдельного таймера у лимита нет, а протухшие окна иначе копились бы
      // по адресу на каждого, кто позвонил однажды.
      for (const [stale, value] of windows) {
        if (moment - value.startedAt >= 60_000) {
          windows.delete(stale);
        }
      }

      windows.set(key, { startedAt: moment, count: 1 });

      return true;
    }

    window.count += 1;

    return window.count <= limit;
  };

  const build = (): Route[] => {
    const declared = registry
      .pluginContributions()
      .filter(
        (registration): registration is RouteRegistration =>
          (registration.kind === "route" || registration.kind === "public-route") &&
          registration.ownership === "plugin",
      );

    const claims = new Map<string, RouteRegistration[]>();

    for (const registration of declared) {
      const claim = `${registration.method} ${pathOf(registration)}`;

      claims.set(claim, [...(claims.get(claim) ?? []), registration]);
    }

    const routes: Route[] = [];

    for (const [claim, claimants] of [...claims].sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    )) {
      const single = claimants[0];

      if (claimants.length !== 1 || single === undefined) {
        // Спор за адрес разрешается как спор за идентификатор вклада: не применяется ни один, и
        // названы оба претендента (docs/plugins.md).
        logger.warn("the address is claimed by several contributions and answers to none", {
          address: claim,
          contributions: claimants.map((claimant) => claimant.id),
        });
        continue;
      }

      routes.push(routeOf(single));
    }

    return routes;
  };

  const routeOf = (registration: RouteRegistration): Route => {
    const open = registration.kind === "public-route";

    return {
      method: registration.method,
      path: pathOf(registration),
      ...(open ? { access: "public" as const } : {}),
      // Тело не разбирается как json: его форму знает автор маршрута, а вебхук приносит что угодно.
      body: "raw",
      bodyLimitBytes: options.bodyLimitBytes(),
      handle: async (context) => {
        const caller = callerOf(context.request);

        if (open && !withinLimit(`${registration.id}|${caller}`)) {
          logger.warn("the public route of a plugin was called too often and refused", {
            plugin: registration.pluginKey,
            contribution: registration.id,
            caller,
          });
          respondWithError(context.response, 429, "too many requests to this route");

          return;
        }

        // Вызов извне и вызов из интерфейса обязаны различаться в журнале: иначе в логах не видно,
        // что действие пришло снаружи (docs/web-api.md).
        logger[open ? "info" : "debug"]("a route of a plugin was called", {
          plugin: registration.pluginKey,
          contribution: registration.id,
          method: registration.method,
          path: pathOf(registration),
          access: open ? "public" : "session",
          ...(open ? { caller } : {}),
        });

        const outcome = await plugins.call(
          registration.pluginKey,
          {
            kind: "route",
            contributionId: registration.declaredId,
            request: requestFor(registration, context, open),
          },
          { timeoutMilliseconds: options.timeoutMilliseconds() },
        );

        if (outcome.kind === "value") {
          write(registration, context.response, outcome.value);

          return;
        }

        const reason =
          outcome.kind === "timed-out"
            ? `did not answer in ${outcome.waitedMilliseconds} ms`
            : outcome.reason;

        logger.error("the route of a plugin did not answer with a response", {
          plugin: registration.pluginKey,
          contribution: registration.id,
          outcome: outcome.kind,
          reason,
        });

        // Подробности остаются в журнале, наружу они не идут: у публичного маршрута снаружи чужой,
        // а у обычного причина всё равно про внутренности плагина (docs/web-api.md).
        if (outcome.kind === "timed-out") {
          respondWithError(context.response, 504, "the plugin did not answer in time");

          return;
        }

        respondWithError(context.response, 500, "internal error");
      },
    };
  };

  /** Заголовки как есть, именами в нижнем регистре: публичный маршрут аутентифицирует себя сам. */
  const headersOf = (request: IncomingMessage): Record<string, string> =>
    Object.fromEntries(
      Object.entries(request.headers).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]],
      ),
    );

  const requestFor = (
    registration: RouteRegistration,
    context: {
      url: URL;
      parameters: Record<string, string>;
      body: unknown;
      request: IncomingMessage;
    },
    open: boolean,
  ): PluginRouteRequest => {
    const body = context.body;

    return {
      method: registration.method,
      path: registration.path,
      parameters: context.parameters,
      query: Object.fromEntries(context.url.searchParams),
      headers: headersOf(context.request),
      // Тело едет байтами всегда: копия, а не сам буфер, потому что структурное клонирование иначе
      // унесло бы кусок общего пула Node вместе с чужими данными рядом.
      ...(body instanceof Buffer && body.length > 0
        ? { body: new Uint8Array(body.subarray()) }
        : {}),
      public: open,
    };
  };

  const write = (
    registration: RouteRegistration,
    response: ServerResponse,
    value: unknown,
  ): void => {
    const answered = (value ?? {}) as PluginRouteResponse;
    const status = answered.status ?? 200;

    if (!Number.isInteger(status) || status < 100 || status > 599) {
      logger.error("the route of a plugin answered with a status that is not a status", {
        contribution: registration.id,
        status,
      });
      respondWithError(response, 500, "internal error");

      return;
    }

    const body =
      typeof answered.body === "string"
        ? Buffer.from(answered.body, "utf8")
        : answered.body === undefined
          ? undefined
          : Buffer.from(answered.body);

    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(answered.headers ?? {})) {
      const lowered = name.toLowerCase();

      // Длину и способ передачи считает сервер: плагин, назвавший их сам, оборвал бы ответ.
      if (reservedHeaders.has(lowered)) {
        logger.warn("the route of a plugin tried to set a header that belongs to the server", {
          contribution: registration.id,
          header: lowered,
        });
        continue;
      }

      headers[lowered] = String(value);
    }

    if (body !== undefined && headers["content-type"] === undefined) {
      // Угадывать json по первому символу — это второе правило разбора рядом с первым: текст
      // остаётся текстом, байты — байтами, а свой тип плагин называет сам.
      headers["content-type"] =
        typeof answered.body === "string"
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";
    }

    response.writeHead(status, {
      ...headers,
      ...(body === undefined ? {} : { "content-length": body.byteLength }),
    });
    response.end(body);
  };

  return {
    routes: () => {
      const revision = registry.revision();
      // Предел тела лежит в строке таблицы, поэтому он часть ключа снимка: правка `config.json`
      // ревизию реестра не двигает, и без этого таблица отвечала бы прежним пределом до следующей
      // перезагрузки плагина. Найдено проверкой запуском, а не тестом.
      const bodyLimitBytes = options.bodyLimitBytes();

      if (built?.revision !== revision || built.bodyLimitBytes !== bodyLimitBytes) {
        built = { revision, bodyLimitBytes, routes: build() };
      }

      return built.routes;
    },
  };
}

/** Адрес маршрута: `/p/<id плагина>/<путь>`. Пустой путь — сам плагин, и это законный адрес. */
function pathOf(registration: RouteRegistration): string {
  return registration.path === ""
    ? `/p/${registration.pluginId}`
    : `/p/${registration.pluginId}/${registration.path}`;
}
