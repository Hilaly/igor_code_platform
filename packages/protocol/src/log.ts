/**
 * Журнал наружу не отдаётся: единственный его получатель — `stdout` демона (docs/logging.md). Форма записи
 * поэтому не часть контракта веб-API, а внутреннее дело демона; тип лежит здесь за компанию с
 * `LogLevel`, который нужен здесь же для типа `config.json`.
 */

/** Порядок значим: он же порядок серьёзности. */
export const logLevels = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof logLevels)[number];

/**
 * Источник — не свободный текст: лог падающего плагина обязан отличаться от лога ядра.
 * Подставляет его ядро, а не плагин (docs/logging.md).
 */
export type LogSource = "core" | `plugin:${string}` | `session:${string}`;

export type LogRecord = {
  /** Момент записи, ISO 8601. */
  time: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  /** Произвольные дополнительные поля записи. Секреты в лог не попадают (docs/logging.md). */
  [field: string]: unknown;
};
