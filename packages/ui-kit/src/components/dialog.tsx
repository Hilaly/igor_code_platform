/**
 * Модальный слой: диалог по центру и выдвижная панель у края. Рисуется порталом в `body`, а не на месте
 * вызова, — иначе `overflow: hidden` или `transform` любого предка обрежет слой и утащит затемнение
 * внутрь панели.
 *
 * Фокус держит `useFocusTrap`: пока слой открыт, Tab по странице под затемнением не ходит.
 */

import type { MouseEvent, ReactNode } from "react";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "../hooks/use-focus-trap.ts";
import { Button } from "./button.tsx";
import styles from "./dialog.module.css";

/** `drawer` — тот же модальный слой, прижатый к краю: длинный список настроек, а не вопрос. */
export type DialogVariant = "modal" | "drawer";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Пояснение под заголовком. Читается скринридером как описание слоя. */
  description?: string;
  variant?: DialogVariant;
  /** Разрешено ли закрытие по Escape и по клику в затемнение. Необратимое действие их запрещает. */
  dismissible?: boolean;
  /** Кнопки внизу слоя. Порядок задаёт вызывающий. */
  footer?: ReactNode;
  children?: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  variant = "modal",
  dismissible = true,
  footer,
  children,
}: DialogProps) {
  const baseId = useId();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const titleId = `${baseId}-title`;
  const descriptionId = description === undefined ? undefined : `${baseId}-description`;

  useFocusTrap({
    active: open,
    closeOnEscape: dismissible,
    containerRef: surfaceRef,
    onClose,
  });

  // Проверка документа, а не только `open`: при отрисовке на сервере портала некуда поставить, и
  // модальный слой на первом кадре всё равно был бы неверен — фокуса там нет.
  if (!open || typeof document === "undefined") {
    return null;
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>): void {
    // Ровно по затемнению: клик внутри слоя всплывает до затемнения и иначе закрывал бы слой.
    if (dismissible && event.target === event.currentTarget) {
      onClose();
    }
  }

  return createPortal(
    <div
      className={`${styles.backdrop}${variant === "drawer" ? ` ${styles.backdropDrawer}` : ""}`}
      onClick={handleBackdropClick}
    >
      <div
        className={`${styles.surface} ${styles[variant]}`}
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        // Слой обязан уметь принять фокус сам: контролов внутри может не быть вовсе.
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.title} id={titleId}>
            {title}
          </div>
          {description === undefined ? undefined : (
            <div className={styles.description} id={descriptionId}>
              {description}
            </div>
          )}
        </header>
        {children === undefined ? undefined : <div className={styles.content}>{children}</div>}
        {footer === undefined ? undefined : <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Подтверждается разрушительное действие: подтверждающая кнопка красится опасностью. */
  destructive?: boolean;
  /** Действие в работе: слой не закрывается, обе кнопки заблокированы. */
  pending?: boolean;
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = false,
  pending = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      // Пока действие в работе, закрыть слой нельзя ничем: ни Escape, ни кликом, ни отменой. Иначе
      // подтверждение уже ушло, а спросивший о нём больше ничего не узнает.
      dismissible={!pending}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            tone={destructive ? "danger" : "accent"}
            onClick={onConfirm}
            disabled={pending}
            busy={pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
