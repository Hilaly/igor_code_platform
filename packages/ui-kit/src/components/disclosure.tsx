/**
 * Подробности по требованию: `<details>` и `<summary>`. Раскрытие ведёт браузер, а не состояние
 * React, — схема нагрузки вклада разворачивается и без единой строки нашего кода, включая ту, что
 * ищется поиском по странице.
 */

import type { ReactNode } from "react";

import styles from "./disclosure.module.css";

export type DisclosureProps = {
  /** Подпись закрытого состояния: она объясняет, что развернётся. */
  summary: string;
  children: ReactNode;
};

export function Disclosure({ summary, children }: DisclosureProps) {
  return (
    <details className={styles.disclosure}>
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
