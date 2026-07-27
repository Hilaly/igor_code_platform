import assert from "node:assert/strict";
import { test } from "node:test";

import type { LogLevel, LogRecord, LogSource } from "@sovereign/protocol";

import { createLogger } from "./logger.ts";

function collect(level: () => LogLevel = () => "debug", source: LogSource = "core") {
  const records: LogRecord[] = [];
  const logger = createLogger({
    source,
    level,
    write: (record) => records.push(record),
    now: () => new Date("2026-07-26T10:00:00.000Z"),
  });

  return { logger, records };
}

test("a record carries the time, the level, the source and the message", () => {
  const { logger, records } = collect();

  logger.info("daemon started", { port: 8787 });

  assert.deepEqual(records, [
    {
      time: "2026-07-26T10:00:00.000Z",
      level: "info",
      source: "core",
      message: "daemon started",
      port: 8787,
    },
  ]);
});

test("records below the current level are dropped", () => {
  const { logger, records } = collect(() => "warn");

  logger.debug("noise");
  logger.info("noise");
  logger.warn("kept");
  logger.error("kept");

  assert.deepEqual(
    records.map((record) => record.level),
    ["warn", "error"],
  );
});

test("the level is read at the moment of the call, so a hot reload takes effect", () => {
  let level: LogLevel = "warn";
  const { logger, records } = collect(() => level);

  logger.info("dropped");
  level = "debug";
  logger.info("kept");

  assert.deepEqual(
    records.map((record) => record.message),
    ["kept"],
  );
});

test("the source of a plugin record travels as it is", () => {
  const { logger, records } = collect(() => "debug", "plugin:hello");

  logger.info("the plugin said something");

  assert.deepEqual(records, [
    {
      time: "2026-07-26T10:00:00.000Z",
      level: "info",
      source: "plugin:hello",
      message: "the plugin said something",
    },
  ]);
});

test("extra fields cannot overwrite the service ones", () => {
  const { logger, records } = collect();

  logger.info("real message", {
    time: "1970-01-01T00:00:00.000Z",
    level: "debug",
    source: "plugin:evil",
    message: "forged message",
  });

  assert.deepEqual(records, [
    {
      time: "2026-07-26T10:00:00.000Z",
      level: "info",
      source: "core",
      message: "real message",
    },
  ]);
});
