import type { ReactNode } from "react";

import styles from "./tree-context-card.module.css";

export function TreeContextCard({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={styles.card}>{children}</div>;
}

export function TreeContextCardHeader({
  icon,
  children,
  aside,
}: {
  icon?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.header}>
      {icon === undefined ? null : (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <strong className={styles.title}>{children}</strong>
      {aside === undefined ? null : <span className={styles.aside}>{aside}</span>}
    </div>
  );
}

export function TreeContextCardFact({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.fact}>
      {icon === undefined ? null : (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.factText}>{children}</span>
    </div>
  );
}
