/**
 * Системные всплывающие уведомления: ToastContainer, ToastProvider и хук useToast.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import styles from "./toast.module.css";

export type ToastTone = "normal" | "success" | "warning" | "danger";

export type ToastMessage = {
  id: string;
  title: string;
  tone?: ToastTone;
  durationMs?: number;
};

export type ToastInput = Omit<ToastMessage, "id">;

export type ToastApi = {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export type ToastProviderProps = {
  children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(0);

  const toast = useCallback((input: ToastInput) => {
    const id = `toast-${nextToastId.current}`;
    nextToastId.current += 1;
    const newToast: ToastMessage = { ...input, id };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [dismiss, toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast должен использоваться внутри <ToastProvider>");
  }
  return context;
}

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

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
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
