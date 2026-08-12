/**
 * Поле ввода — одной строкой и многострочное. Метки, подсказки и текста ошибки здесь нет: их даёт
 * `Field` (field.tsx), и поле принимает от него готовые `id` и `describedBy`. Иначе метка была бы у
 * поля и у обвязки одновременно, и связь с ошибкой зависела бы от того, кто из них её объявил.
 */

import { forwardRef, useEffect, useRef, type CSSProperties } from "react";

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
  "aria-label"?: string;
  /**
   * Поле тянется под содержимое. Без этого ввод сообщения в чат — это либо одна строка на длинный
   * запрос, либо пустая простыня на короткий.
   */
  autoGrow?: boolean;
  /** Предел роста в строках. Дальше поле прокручивается внутри себя, а не выдавливает ленту. */
  maxRows?: number;
  /**
   * Отправка с клавиатуры: `Enter` без модификаторов. `Shift+Enter` переводит строку — так устроен
   * каждый чат, и переучивать здесь нечему. Пустое сообщение не отправляется: демон принял бы его и
   * потратил обращение к модели.
   */
  onSubmit?: () => void;
  /**
   * Разрешить отправку пустого поля. Нужно там, где сообщение бывает не только текстом: к пустому
   * полю приложена картинка, и «пустое сообщение» перестаёт значить «отправлять нечего».
   */
  submitWhenEmpty?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    value,
    onChange,
    placeholder,
    invalid = false,
    disabled = false,
    id,
    describedBy,
    rows,
    "aria-label": ariaLabel,
    autoGrow = false,
    maxRows,
    onSubmit,
    submitWhenEmpty = false,
    onKeyDown,
    onPaste,
  },
  ref,
) {
  const own = useRef<HTMLTextAreaElement>(null);

  /**
   * Высоту знает только браузер: `scrollHeight` измеряется после того, как высота сброшена, иначе
   * поле умеет расти и никогда не уменьшается. Предел ставит CSS через `--textarea-max-rows` —
   * считать его в пикселях значило бы повторять здесь межстрочный интервал из стилей.
   */
  useEffect(() => {
    const element = own.current;

    if (element === null || !autoGrow) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${String(element.scrollHeight)}px`;
  }, [autoGrow, value]);

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
      aria-label={ariaLabel}
      style={
        maxRows === undefined
          ? undefined
          : ({ "--textarea-max-rows": String(maxRows) } as CSSProperties)
      }
      onChange={(event) => onChange(event.target.value)}
      onPaste={onPaste}
      onKeyDown={(event) => {
        onKeyDown?.(event);

        // Метод ввода ещё собирает символ: `Enter` подтверждает вариант, а не отправляет сообщение.
        if (
          onSubmit === undefined ||
          event.key !== "Enter" ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.nativeEvent.isComposing ||
          (value.trim() === "" && !submitWhenEmpty)
        ) {
          return;
        }

        event.preventDefault();
        onSubmit();
      }}
      ref={(element) => {
        own.current = element;

        if (typeof ref === "function") {
          ref(element);
        } else if (ref !== null) {
          ref.current = element;
        }
      }}
    />
  );
});
