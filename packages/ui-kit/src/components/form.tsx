/**
 * Форма как примитив: перехватывает сабмит и зовёт `onSubmit`, не перезагружая страницу. Нужна там,
 * где Enter в поле должен подтверждать действие, а писать `onKeyDown` в каждый `Input` — то же самое
 * по-другому. Своей геометрии нет: форма — контейнер, раскладку задаёт вызывающий.
 */

import type { FormEvent, ReactNode } from "react";

import styles from "./form.module.css";

export type FormProps = {
  onSubmit: () => void;
  children: ReactNode;
  /** Имя формы для скринридера, когда рядом есть несколько самостоятельных действий. */
  label?: string;
  /** Заблокированная форма не сабмитится: например, пока идёт создание. */
  disabled?: boolean;
};

export function Form({ onSubmit, children, label, disabled = false }: FormProps) {
  return (
    <form
      className={styles.form}
      aria-label={label}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        // Браузер по сабмиту перезагружает страницу — это не то, что нужно ни в одном случае.
        event.preventDefault();

        if (!disabled) {
          onSubmit();
        }
      }}
    >
      {children}
    </form>
  );
}
