import type { Health } from "@sovereign/protocol";

export function buildHealth(startedAt: Date, now: Date): Health {
  return {
    status: "ok",
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor((now.getTime() - startedAt.getTime()) / 1000),
  };
}
