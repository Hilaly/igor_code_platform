/**
 * Пустое состояние и индикатор загрузки. Оба принимают уже переведённые строки: кит не знает, в каком
 * неймспейсе они лежат.
 */

export type EmptyStateProps = {
  title: string;
  hint?: string;
};

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="sv-empty">
      <span className="sv-empty-title">{title}</span>
      {hint === undefined ? undefined : <span className="sv-empty-hint">{hint}</span>}
    </div>
  );
}

export type SpinnerProps = {
  /** Что грузится. Крутилка без подписи ничего не сообщает тому, кто её не видит. */
  label: string;
};

export function Spinner({ label }: SpinnerProps) {
  return (
    <span className="sv-spinner" role="status">
      <span className="sv-spinner-mark" aria-hidden="true" />
      <span className="sv-spinner-label">{label}</span>
    </span>
  );
}
