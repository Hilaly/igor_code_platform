/** Кнопка. `pressed` — для выбора из нескольких кнопок: выбранная обязана быть видна и скринридеру. */

import type { ReactNode } from "react";

export type ButtonTone = "normal" | "accent" | "danger";

export type ButtonProps = {
  tone?: ButtonTone;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Подсказка при наведении: для кнопки без подписи она единственное объяснение. */
  title?: string;
  children: ReactNode;
};

export function Button({
  tone = "normal",
  onClick,
  disabled = false,
  pressed,
  title,
  children,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`sv-button sv-button-${tone}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
    >
      {children}
    </button>
  );
}
