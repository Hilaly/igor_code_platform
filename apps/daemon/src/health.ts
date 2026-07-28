import { healthPath, type Health } from "@sovereign/protocol";

import { respondWithJson, type Route } from "./dispatcher.ts";

/**
 * Маршрут открыт: это проба «жив ли демон», и она обязана работать до входа — иначе неотвеченный
 * запрос перестал бы отличать лежащий демон от закрытой сессии. Наружу он отдаёт момент старта и
 * время работы, то есть ровно то, что и так видно по факту ответа (docs/authentication.md).
 */
export function healthRoute(startedAt: Date): Route {
  return {
    method: "GET",
    path: healthPath,
    access: "open",
    handle: ({ response }) => respondWithJson(response, 200, buildHealth(startedAt, new Date())),
  };
}

export function buildHealth(startedAt: Date, now: Date): Health {
  return {
    status: "ok",
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor((now.getTime() - startedAt.getTime()) / 1000),
  };
}
