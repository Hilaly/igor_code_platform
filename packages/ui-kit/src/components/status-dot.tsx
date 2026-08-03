/** Компактное состояние, смысл которого всегда назван текстом, а не только цветом. */

import styles from "./status-dot.module.css";

export type StatusDotTone = "positive" | "pending" | "danger";

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
