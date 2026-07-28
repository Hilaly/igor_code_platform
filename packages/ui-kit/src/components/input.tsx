/**
 * Поле ввода — одной строкой и многострочное. Метки, подсказки и текста ошибки здесь нет: их даёт
 * `Field` (field.tsx), и поле принимает от него готовые `id` и `describedBy`. Иначе метка была бы у
 * поля и у обвязки одновременно, и связь с ошибкой зависела бы от того, кто из них её объявил.
 */

import styles from "./input.module.css";

/** Тип поля меняет поведение браузера: скрытие символов, кнопку очистки в поиске. */
export type InputType = "text" | "password" | "search";

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
};

export function Input({
  value,
  onChange,
  placeholder,
  invalid = false,
  disabled = false,
  id,
  describedBy,
  type = "text",
}: InputProps) {
  return (
    <input
      className={`${styles.control} ${styles.input}`}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      id={id}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

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
