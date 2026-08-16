/** Компактное состояние, смысл которого всегда назван текстом, а не только цветом. */

import styles from "./status-dot.module.css";

/**
 * `neutral` — состояние, которое ещё не наступило: шаг не начат, задание не запускали. Отличается от
 * `pending` тем, что ничего не происходит и ждать нечего, поэтому и цвет у него не предупреждающий.
 */
export type StatusDotTone = "positive" | "pending" | "danger" | "neutral";

export type StatusDotProps = {
  tone: StatusDotTone;
  /** Полное состояние для скринридера и подсказки при наведении. */
  label: string;
};

export function StatusDot({ tone, label }: StatusDotProps) {
  return (
    <span
      className={`${styles.dot} ${styles[tone]}`}
      role="status"
      aria-label={label}
      title={label}
    />
  );
}
