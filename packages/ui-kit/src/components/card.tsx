/**
 * Карточка: поверхность под связную группу содержимого внутри страницы. От `Panel` отличается шапкой:
 * у панели это заголовок третьего уровня, а у карточки — ярлык, который называет группу, но не спорит
 * с заголовками самой страницы. От `RaisedSurface` — тем, что у неё есть эта шапка и предметное место
 * под неё; `RaisedSurface` остаётся безымянной поверхностью для композера и всплывающих списков.
 *
 * Раскладки содержимого карточка не назначает: строки, список или текст кладёт вызывающий.
 */

import type { ReactNode } from "react";

import styles from "./card.module.css";

export type CardProps = {
  /** Ярлык-шапка: уже переведённая строка или её разметка. Без него шапки нет вовсе. */
  label?: ReactNode;
  /**
   * Идентификатор ярлыка. Нужен, когда содержимое ссылается на него `aria-labelledby`: имя списка
   * берётся из видимого текста, а не дублируется вторым, невидимым.
   */
  labelId?: string;
  children: ReactNode;
};

export function Card({ label, labelId, children }: CardProps) {
  return (
    <div className={styles.card}>
      {label === undefined ? undefined : (
        <div className={styles.label} id={labelId}>
          {label}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
