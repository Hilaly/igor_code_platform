import { EmptyState, Notice, Spinner, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import type { OpenSession } from "./state.ts";

export type SessionRouteViewProps = {
  sessionId: string;
  open?: OpenSession;
  children: ReactNode;
  translator: ScopedTranslator;
};

/** Route guard: a chat is rendered only for the session named by the current URL. */
export function SessionRouteView({ sessionId, open, children, translator }: SessionRouteViewProps) {
  const { t } = translator;

  if (open === undefined || open.id !== sessionId || open.loading) {
    return (
      <div className="sessions session-route-state">
        <Spinner label={t("state.loading")} />
      </div>
    );
  }

  if (open.summary === undefined) {
    if (open.failure !== undefined) {
      return (
        <div className="sessions session-route-state">
          <Notice tone="danger" title={open.failure} />
        </div>
      );
    }

    return (
      <div className="sessions sessions-chat session-route-state">
        <EmptyState title={t("sessions.gone.title")} hint={t("sessions.gone.hint")} />
      </div>
    );
  }

  return children;
}
