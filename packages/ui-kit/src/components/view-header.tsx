/** Нейтральная шапка контейнерного view с заголовком и действиями вызывающего. */

import type { ReactNode } from "react";

import styles from "./view-header.module.css";
import { Heading } from "./text.tsx";

export type ViewHeaderProps = {
  title: ReactNode;
  context?: ReactNode;
  level?: 1 | 2 | 3;
  actions?: ReactNode;
};

export function ViewHeader({ title, context, level = 1, actions }: ViewHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headingGroup}>
        <div className={styles.title}>
          <Heading level={level}>{title}</Heading>
        </div>
        {context == null ? undefined : (
          <span
            className={styles.context}
            title={typeof context === "string" ? context : undefined}
          >
            {context}
          </span>
        )}
      </div>
      {actions == null ? undefined : <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
