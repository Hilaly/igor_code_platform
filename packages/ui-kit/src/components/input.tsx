/**
 * Поле ввода — одной строкой и многострочное. Метки, подсказки и текста ошибки здесь нет: их даёт
 * `Field` (field.tsx), и поле принимает от него готовые `id` и `describedBy`. Иначе метка была бы у
 * поля и у обвязки одновременно, и связь с ошибкой зависела бы от того, кто из них её объявил.
 */

import { forwardRef } from "react";

import styles from "./input.module.css";

/** Тип поля меняет поведение браузера: скрытие символов, кнопку очистки в поиске. */
export type InputType = "text" | "password" | "search";

/**
 * Что подставлять менеджеру паролей. Список закрыт, а не свободная строка: значений в стандарте
 * десятки, и открытая строка означала бы опечатку, которую видно только в чужом браузере.
 */
export type InputAutoComplete = "off" | "username" | "current-password" | "new-password";

export type InputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Значение не проходит проверку. Сам текст ошибки показывает `Field`. */
  invalid?: boolean;
  disabled?: boolean;
  /** Связь с меткой. В паре с `Field` приходит из его рендер-пропа, а не придумывается вызывающим. */
  id?: string;
  /** Идентификаторы подсказки и ошибки для `aria-describedby`; их собирает `Field`. */
  describedBy?: string;
  type?: InputType;
  /**
   * Не ставится по умолчанию: браузер угадывает сам, и назвать роль поля должен тот, кто знает форму
   * целиком, — иначе менеджер паролей предложит текущий пароль там, где просят новый.
   */
  autoComplete?: InputAutoComplete;
  role?: string;
  readOnly?: boolean;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-label"?: string;
  "aria-autocomplete"?: "none" | "inline" | "list" | "both";
  "aria-activedescendant"?: string;
  "aria-haspopup"?: boolean | "menu" | "listbox" | "tree" | "grid" | "dialog";
  "aria-describedby"?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    value,
    onChange,
    placeholder,
    invalid = false,
    disabled = false,
    id,
    describedBy,
    type = "text",
    autoComplete,
    role,
    readOnly,
    "aria-expanded": ariaExpanded,
    "aria-controls": ariaControls,
    "aria-label": ariaLabel,
    "aria-autocomplete": ariaAutocomplete,
    "aria-activedescendant": ariaActiveDescendant,
    "aria-haspopup": ariaHasPopup,
    "aria-describedby": ariaDescribedBy,
    onKeyDown,
    onFocus,
    onBlur,
    onClick,
  },
  ref,
) {
  return (
    <input
      className={`${styles.control} ${styles.input}`}
      type={type}
      autoComplete={autoComplete}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      id={id}
      role={role}
      readOnly={readOnly}
      aria-invalid={invalid}
      aria-describedby={ariaDescribedBy || describedBy}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-label={ariaLabel}
      aria-autocomplete={ariaAutocomplete}
      aria-activedescendant={ariaActiveDescendant}
      aria-haspopup={ariaHasPopup}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      ref={ref}
    />
  );
});

export type TextareaProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
  /** Высота в строках. Растягивать поле дальше вызывающий может сам — вертикальный `resize` разрешён. */
  rows?: number;
};

export function Textarea({
  value,
  onChange,
  placeholder,
  invalid = false,
  disabled = false,
  id,
  describedBy,
  rows,
}: TextareaProps) {
  return (
    <textarea
      className={`${styles.control} ${styles.textarea}`}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      id={id}
      rows={rows}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
