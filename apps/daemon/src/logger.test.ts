import assert from "node:assert/strict";
import { test } from "node:test";

import type { LogLevel, LogRecord } from "@sovereign/protocol";

import { createEventBus } from "./event-bus.ts";
import { createLogger, createRecordWriter } from "./logger.ts";

function collect(level: () => LogLevel = () => "debug") {
  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
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

test("a record reaches both stdout and the bus", () => {
  const stdout: LogRecord[] = [];
  const published: LogRecord[] = [];
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  bus.subscribe((event) => published.push(event.payload));

  const logger = createLogger({
    source: "plugin:hello",
    level: () => "info",
    write: createRecordWriter({ bus, toStdout: (record) => stdout.push(record) }),
    now: () => new Date("2026-07-26T10:00:00.000Z"),
  });

  logger.info("the plugin said something");

  const expected: LogRecord = {
    time: "2026-07-26T10:00:00.000Z",
    level: "info",
    // Источник плагина доезжает до шины как есть: подписчик обязан отличить плагин от ядра.
    source: "plugin:hello",
    message: "the plugin said something",
  };

  assert.deepEqual(stdout, [expected]);
  assert.deepEqual(published, [expected]);
});

test("a record below the current level reaches nobody, not even the bus", () => {
  const stdout: LogRecord[] = [];
  const published: LogRecord[] = [];
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  bus.subscribe((event) => published.push(event.payload));

  const logger = createLogger({
    source: "core",
    level: () => "warn",
    write: createRecordWriter({ bus, toStdout: (record) => stdout.push(record) }),
  });

  logger.debug("noise");

  assert.deepEqual(stdout, []);
  assert.deepEqual(published, []);
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
