import { healthPath, type Health } from "@sovereign/protocol";

import { respondWithJson, type Route } from "./dispatcher.ts";

export function healthRoute(startedAt: Date): Route {
  return {
    method: "GET",
    path: healthPath,
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
