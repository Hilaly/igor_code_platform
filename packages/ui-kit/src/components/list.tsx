/**
 * Список со строками. Выбираемая строка — кнопка, а не `div` с обработчиком: иначе по ней нельзя
 * пройти с клавиатуры.
 */

import type { ReactNode } from "react";

import styles from "./list.module.css";

export type ListProps = {
  children: ReactNode;
};

export function List({ children }: ListProps) {
  return <ul className={styles.list}>{children}</ul>;
}

export type ListRowProps = {
  selected?: boolean;
  onSelect?: () => void;
  /**
   * Двойной клик. Не заменяет `onSelect`: выбор и подтверждение — разные жесты (пикер файла
   * выбирает строку одним кликом, а папку открывает двойным). Отдельный обработчик, а не флаг
   * «было два клика»: разница между ними скрыта внутри кнопки и вела бы к гонкам.
   */
  onDoubleClick?: () => void;
  children: ReactNode;
  /** Действия строки стоят рядом с кнопкой выбора: интерактивный элемент нельзя вкладывать в неё. */
  actions?: ReactNode;
};

export function ListRow({
  selected = false,
  onSelect,
  onDoubleClick,
  children,
  actions,
}: ListRowProps) {
  const className = `${styles.row}${selected ? ` ${styles.selected}` : ""}`;

  if (onSelect === undefined) {
    return (
      <li className={className}>
        {children}
        {actions === undefined ? undefined : <span className={styles.actions}>{actions}</span>}
      </li>
    );
  }

  return (
    <li className={className}>
      <button
        type="button"
        className={styles.select}
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        aria-current={selected}
      >
        {children}
      </button>
      {actions === undefined ? undefined : <span className={styles.actions}>{actions}</span>}
    </li>
  );
}
