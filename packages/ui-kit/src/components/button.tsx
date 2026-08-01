/** Кнопка. `pressed` — для выбора из нескольких кнопок: выбранная обязана быть видна и скринридеру. */

import type { ReactNode } from "react";

import styles from "./button.module.css";

export type ButtonTone = "normal" | "accent" | "danger";

export type ButtonSize = "md" | "sm";

export type ButtonProps = {
  tone?: ButtonTone;
  /** Размер: `md` — обычная кнопка действия, `sm` — там, где места мало (шапка панели). */
  size?: ButtonSize;
  /**
   * Только значок: кнопка квадратная, без боковых отступов, контент отцентрирован. Видимого текста у
   * такой кнопки нет, поэтому доступное имя обязано приезжать через `aria-label`, а подсказка — через
   * `title`. Нужно для кнопок скрытия/возврата панелей в оболочке.
   */
  iconOnly?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Занятость операции: помечает кнопку aria-busy для скринридера. */
  busy?: boolean;
  /** Подсказка при наведении: для кнопки без подписи она единственное объяснение. */
  title?: string;
  id?: string;
  describedBy?: string;
  "aria-describedby"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-haspopup"?: boolean | "menu" | "listbox" | "tree" | "grid" | "dialog";
  "aria-label"?: string;
  tabIndex?: number;
  onFocus?: (e: React.FocusEvent<HTMLButtonElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLButtonElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  children: ReactNode;
};

export function Button({
  tone = "normal",
  size = "md",
  iconOnly = false,
  onClick,
  disabled = false,
  pressed,
  busy,
  title,
  id,
  describedBy,
  "aria-describedby": ariaDescribedBy,
  "aria-expanded": ariaExpanded,
  "aria-controls": ariaControls,
  "aria-haspopup": ariaHasPopup,
  "aria-label": ariaLabel,
  tabIndex,
  onFocus,
  onBlur,
  onKeyDown,
  children,
}: ButtonProps) {
  const className = [
    styles.button,
    styles[tone],
    size === "sm" ? styles.sm : "",
    iconOnly ? styles.iconOnly : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      id={id}
      className={className}
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      aria-describedby={[describedBy, ariaDescribedBy].filter(Boolean).join(" ") || undefined}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-haspopup={ariaHasPopup}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      title={title}
    >
      {children}
    </button>
  );
}
