/**
 * Пустое состояние и индикатор загрузки. Оба принимают уже переведённые строки: кит не знает, в каком
 * неймспейсе они лежат.
 */

import styles from "./state.module.css";

export type EmptyStateProps = {
  title: string;
  hint?: string;
};

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.title}>{title}</span>
      {hint === undefined ? undefined : <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export type SpinnerProps = {
  /** Что грузится. Крутилка без подписи ничего не сообщает тому, кто её не видит. */
  label: string;
};

export function Spinner({ label }: SpinnerProps) {
  return (
    <span className={styles.spinner} role="status">
      <span className={styles.mark} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
