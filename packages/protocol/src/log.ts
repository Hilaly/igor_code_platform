/**
 * Формат записи лога — часть контракта веб-API (ADR-0021): интерфейс показывает те же записи,
 * которые уходят в `stdout`, поэтому тип живёт здесь, а не в демоне.
 */

/** Порядок значим: он же порядок серьёзности. */
export const logLevels = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof logLevels)[number];

/**
 * Источник — не свободный текст: лог падающего плагина обязан отличаться от лога ядра.
 * Подставляет его ядро, а не плагин (ADR-0021).
 */
export type LogSource = "core" | `plugin:${string}` | `session:${string}`;

export type LogRecord = {
  /** Момент записи, ISO 8601. */
  time: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  /** Произвольные дополнительные поля записи. Секреты в лог не попадают (ADR-0021). */
  [field: string]: unknown;
};
