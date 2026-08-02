import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHealth } from "./health.ts";

test("uptime is counted from the start moment", () => {
  const startedAt = new Date("2026-07-26T10:00:00.000Z");
  const now = new Date("2026-07-26T10:01:30.000Z");

  assert.deepEqual(buildHealth(startedAt, now), {
    status: "ok",
    startedAt: "2026-07-26T10:00:00.000Z",
    uptimeSeconds: 90,
  });
});

test("uptime is zero at the moment of start", () => {
  const startedAt = new Date("2026-07-26T10:00:00.000Z");

  assert.equal(buildHealth(startedAt, startedAt).uptimeSeconds, 0);
});
