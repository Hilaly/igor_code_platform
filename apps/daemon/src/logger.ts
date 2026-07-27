/**
 * Логгер ядра (ADR-0021). Получателей записи трое, в этом срезе есть двое: `stdout` и шина.
 * Логгер о них не знает — он отдаёт запись в единственную точку расширения `write`, а собирает
 * получателей `createRecordWriter`. База добавится туда же, когда появится `state.db`.
 */

import {
  coreEventTypes,
  logLevels,
  type LogLevel,
  type LogRecord,
  type LogSource,
} from "@sovereign/protocol";

import type { EventBus } from "./event-bus.ts";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
};

export type LoggerOptions = {
  source: LogSource;
  /** Функция, а не значение: уровень приходит из настроек и меняется без перезапуска (ADR-0033). */
  level: () => LogLevel;
  write?: (record: LogRecord) => void;
  now?: () => Date;
};

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? writeLineToStdout;
  const now = options.now ?? (() => new Date());

  const log = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (severityOf(level) < severityOf(options.level())) {
      return;
    }

    const record: LogRecord = {
      time: now().toISOString(),
      level,
      source: options.source,
      message,
    };

    // Служебные поля идут первыми и потому читаются в терминале первыми. Дополнительное поле с
    // таким же именем игнорируется: иначе плагин подделал бы источник записи (ADR-0021).
    for (const [field, value] of Object.entries(fields ?? {})) {
      if (!(field in record)) {
        record[field] = value;
      }
    }

    write(record);
  };

  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
  };
}

export type RecordWriterOptions = {
  bus: EventBus;
  /** Внедряется тестом; в демоне это `stdout`. */
  toStdout?: (record: LogRecord) => void;
};

/**
 * Собирает получателей записи в одну функцию для `LoggerOptions.write`. Порядок значим: `stdout`
 * пишется первым, потому что он единственный переживает падение подписчика шины.
 */
export function createRecordWriter(options: RecordWriterOptions): (record: LogRecord) => void {
  const toStdout = options.toStdout ?? writeLineToStdout;

  return (record) => {
    toStdout(record);
    options.bus.publish(coreEventTypes.log, record);
  };
}

function writeLineToStdout(record: LogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function severityOf(level: LogLevel): number {
  return logLevels.indexOf(level);
}
