import { EmptyState, Spinner, type ScopedTranslator } from "@sovereign/ui-kit";
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
    return <Spinner label={t("state.loading")} />;
  }

  if (open.summary === undefined) {
    return (
      <div className="sessions-chat">
        <EmptyState title={t("sessions.gone.title")} hint={t("sessions.gone.hint")} />
      </div>
    );
  }

  return children;
}
