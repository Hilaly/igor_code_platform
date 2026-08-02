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
  /** Заблокированная форма не сабмитится: например, пока идёт создание. */
  disabled?: boolean;
};

export function Form({ onSubmit, children, disabled = false }: FormProps) {
  return (
    <form
      className={styles.form}
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
