/** Компонент навигационных хлебных крошек Breadcrumbs. */

import type { ReactNode } from "react";

import styles from "./breadcrumbs.module.css";

export type BreadcrumbItem = {
  id: string;
  label: string;
  onClick?: () => void;
  href?: string;
};

export type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  separator?: ReactNode;
  ariaLabel?: string;
};

export function Breadcrumbs({
  items,
  separator = "╱",
  ariaLabel = "Хлебные крошки",
}: BreadcrumbsProps) {
  return (
    <nav className={styles.nav} aria-label={ariaLabel}>
      <ol className={styles.list}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li
              key={item.id}
              className={`${styles.item}${isLast ? ` ${styles.current}` : ""}`}
              aria-current={isLast ? "page" : undefined}
            >
              {isLast ? (
                <span>{item.label}</span>
              ) : item.href ? (
                <a href={item.href} className={styles.link} onClick={item.onClick}>
                  {item.label}
                </a>
              ) : (
                <button type="button" className={styles.link} onClick={item.onClick}>
                  {item.label}
                </button>
              )}
              {!isLast ? <span className={styles.separator}>{separator}</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
