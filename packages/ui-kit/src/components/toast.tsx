/**
 * Компонент системных всплывающих уведомлений ToastContainer.
 */

import { useEffect } from "react";

import styles from "./toast.module.css";

export type ToastTone = "normal" | "success" | "warning" | "danger";

export type ToastMessage = {
  id: string;
  title: string;
  tone?: ToastTone;
  durationMs?: number;
};

export type ToastContainerProps = {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className={styles.container} role="region" aria-label="Уведомления">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const tone = toast.tone || "normal";
  const duration = toast.durationMs ?? 4000;

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, onDismiss]);

  return (
    <div className={`${styles.toast} ${styles[tone]}`} role="status">
      <span>{toast.title}</span>
      <button
        type="button"
        className={styles.close}
        aria-label="Закрыть"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}
