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
  children: ReactNode;
  /** Действия строки стоят рядом с кнопкой выбора: интерактивный элемент нельзя вкладывать в неё. */
  actions?: ReactNode;
};

export function ListRow({ selected = false, onSelect, children, actions }: ListRowProps) {
  const className = `${styles.row}${selected ? ` ${styles.selected}` : ""}`;

  if (onSelect === undefined) {
    return <li className={className}>{children}</li>;
  }

  return (
    <li className={className}>
      <button type="button" className={styles.select} onClick={onSelect} aria-current={selected}>
        {children}
      </button>
      {actions === undefined ? undefined : <span className={styles.actions}>{actions}</span>}
    </li>
  );
}
