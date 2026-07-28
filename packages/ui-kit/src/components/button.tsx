/** Кнопка. `pressed` — для выбора из нескольких кнопок: выбранная обязана быть видна и скринридеру. */

import type { ReactNode } from "react";

import styles from "./button.module.css";

export type ButtonTone = "normal" | "accent" | "danger";

export type ButtonProps = {
  tone?: ButtonTone;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Занятость операции: помечает кнопку aria-busy для скринридера. */
  busy?: boolean;
  /** Подсказка при наведении: для кнопки без подписи она единственное объяснение. */
  title?: string;
  children: ReactNode;
};

export function Button({
  tone = "normal",
  onClick,
  disabled = false,
  pressed,
  busy,
  title,
  children,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[tone]}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      title={title}
    >
      {children}
    </button>
  );
}
