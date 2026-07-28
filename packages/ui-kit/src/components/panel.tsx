/** Панель: поднятая поверхность с границей, необязательным заголовком и местом под действия. */

import type { ReactNode } from "react";

import styles from "./panel.module.css";
import { Heading } from "./text.tsx";

export type PanelProps = {
  title?: string;
  /** Кнопки в шапке панели. Без заголовка не показываются: шапки в этом случае нет. */
  actions?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, actions, children }: PanelProps) {
  return (
    <section className={styles.panel}>
      {title === undefined ? undefined : (
        <header className={styles.header}>
          <Heading level={3}>{title}</Heading>
          {actions === undefined ? undefined : <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
