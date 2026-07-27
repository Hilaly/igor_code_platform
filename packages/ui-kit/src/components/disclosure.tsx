/**
 * Подробности по требованию: `<details>` и `<summary>`. Раскрытие ведёт браузер, а не состояние
 * React, — схема нагрузки вклада разворачивается и без единой строки нашего кода, включая ту, что
 * ищется поиском по странице.
 */

import type { ReactNode } from "react";

export type DisclosureProps = {
  /** Подпись закрытого состояния: она объясняет, что развернётся. */
  summary: string;
  children: ReactNode;
};

export function Disclosure({ summary, children }: DisclosureProps) {
  return (
    <details className="sv-disclosure">
      <summary className="sv-disclosure-summary">{summary}</summary>
      <div className="sv-disclosure-body">{children}</div>
    </details>
  );
}
