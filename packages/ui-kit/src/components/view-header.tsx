/** Нейтральная шапка контейнерного view с заголовком и действиями вызывающего. */

import type { ReactNode } from "react";

import styles from "./view-header.module.css";
import { Heading } from "./text.tsx";

export type ViewHeaderProps = {
  title: ReactNode;
  level?: 1 | 2 | 3;
  actions?: ReactNode;
};

export function ViewHeader({ title, level = 1, actions }: ViewHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.title}>
        <Heading level={level}>{title}</Heading>
      </div>
      {actions === undefined ? undefined : <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
