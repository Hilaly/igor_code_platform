/**
 * Вью сессий: мастер-деталь — список слева, чат справа. Живёт в ядре, как и вью проектов
 * (docs/architecture.md): сессия с агентом — это то, ради чего платформа существует.
 *
 * Своих запросов здесь нет: всё приходит пропами, а действия уходят наверх.
 */

import type { Session } from "@sovereign/protocol";
import {
  Badge,
  Code,
  EmptyState,
  Heading,
  List,
  ListRow,
  Notice,
  Spinner,
  Text,
  type BadgeTone,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import { ChatPlaceholder, ChatView } from "./chat-view.tsx";
import type { SessionsState } from "./state.ts";

export type SessionsViewProps = {
  state: SessionsState;
  onOpen: (sessionId: string) => void;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  translator: ScopedTranslator;
};

/** Занятая сессия выделяется акцентом: в списке из десятка это единственный способ найти живую. */
const phaseTone = (phase: Session["phase"]): BadgeTone => (phase === "idle" ? "neutral" : "accent");

export function SessionsView(props: SessionsViewProps) {
  const { state, translator } = props;
  const { t } = translator;
  const sessions = state.sessions;

  return (
    <div className="sessions">
      <div className="sessions-head">
        <Heading level={1}>{t("page.sessions.title")}</Heading>
      </div>

      {state.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("sessions.failed", { reason: state.failure })} />
      )}

      {state.problems.length === 0 ? undefined : (
        <Notice tone="warning" title={t("sessions.problems.title")}>
          {state.problems.map((problem) => (
            <Code key={problem}>{problem}</Code>
          ))}
        </Notice>
      )}

      <div className="sessions-split">
        <div className="sessions-list">
          {sessions === undefined ? (
            <Spinner label={t("state.loading")} />
          ) : sessions.length === 0 ? (
            <EmptyState title={t("sessions.empty.title")} hint={t("sessions.empty.hint")} />
          ) : (
            <List>
              {sessions.map((session) => (
                <ListRow
                  key={session.id}
                  selected={session.id === state.open?.id}
                  onSelect={() => props.onOpen(session.id)}
                >
                  <span className="sessions-row">
                    <span className="sessions-row-facts">
                      <Text>{session.title ?? t("sessions.untitled")}</Text>
                      <Text tone="muted">{session.folder}</Text>
                    </span>
                    <Badge tone={phaseTone(session.phase)}>
                      {t(`sessions.phase.${session.phase}`)}
                    </Badge>
                  </span>
                </ListRow>
              ))}
            </List>
          )}
        </div>

        {state.open === undefined ? (
          <ChatPlaceholder translator={translator} />
        ) : state.open.summary === undefined && !state.open.loading ? (
          // Сессия пропала: ссылку могли открыть после того, как проект ушёл в архив.
          <div className="sessions-chat">
            <EmptyState title={t("sessions.gone.title")} hint={t("sessions.gone.hint")} />
          </div>
        ) : (
          <ChatView
            open={state.open}
            onSubmit={props.onSubmit}
            onInterrupt={props.onInterrupt}
            translator={translator}
          />
        )}
      </div>
    </div>
  );
}
