/**
 * Логгер ядра (docs/logging.md). Получатель у записи один — `stdout`. Ни на шину, ни наружу журнал не
 * идёт: событие шины — это событие предметной области, а запись журнала им не является.
 *
 * Получатель всё равно вынесен в `write`: тест обязан читать записи, не разбирая вывод процесса.
 */

import { logLevels, type LogLevel, type LogRecord, type LogSource } from "@sovereign/protocol";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
};

export type LoggerOptions = {
  source: LogSource;
  /** Функция, а не значение: уровень приходит из настроек и меняется без перезапуска (docs/data-directory.md). */
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
    // таким же именем игнорируется: иначе плагин подделал бы источник записи (docs/logging.md).
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

function writeLineToStdout(record: LogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function severityOf(level: LogLevel): number {
  return logLevels.indexOf(level);
}
