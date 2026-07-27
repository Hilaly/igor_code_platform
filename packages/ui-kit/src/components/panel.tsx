/** Панель: поднятая поверхность с границей, необязательным заголовком и местом под действия. */

import type { ReactNode } from "react";

import { Heading } from "./text.tsx";

export type PanelProps = {
  title?: string;
  /** Кнопки в шапке панели. Без заголовка не показываются: шапки в этом случае нет. */
  actions?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, actions, children }: PanelProps) {
  return (
    <section className="sv-panel">
      {title === undefined ? undefined : (
        <header className="sv-panel-header">
          <Heading level={3}>{title}</Heading>
          {actions === undefined ? undefined : <div className="sv-panel-actions">{actions}</div>}
        </header>
      )}
      <div className="sv-panel-body">{children}</div>
    </section>
  );
}
