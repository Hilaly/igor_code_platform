/**
 * Вью сессий: мастер-деталь — список слева, чат справа. Живёт в ядре, как и вью проектов
 * (docs/architecture.md): сессия с агентом — это то, ради чего платформа существует.
 *
 * Своих запросов здесь нет: всё приходит пропами, а действия уходят наверх.
 */

import type {
  Session,
  SessionForkRequest,
  SessionMessage,
  SessionNavigateRequest,
  SessionUpdate,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Heading,
  Input,
  List,
  ListRow,
  Menu,
  Notice,
  Spinner,
  Text,
  Toggle,
  type BadgeTone,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

import type { NavigationOutcome } from "./api.ts";
import { ChatPlaceholder, ChatView } from "./chat-view.tsx";
import type { SessionsState } from "./state.ts";

export type SessionsViewProps = {
  state: SessionsState;
  onOpen: (sessionId: string) => void;
  /** Кнопка «новая сессия» уводит на отдельный экран создания, а не открывает модал. */
  onStartCreating: () => void;
  onSubmit: (text: string) => void;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  onUpdate: (sessionId: string, update: SessionUpdate) => Promise<string | undefined>;
  onRemove: (sessionId: string) => Promise<string | undefined>;
  onFork: (request: SessionForkRequest) => Promise<void>;
  /** Свернуть контекст открытой сессии. Возвращает причину отказа: её показывает панель чата. */
  onCompact: (instructions?: string) => Promise<string | undefined>;
  /** Пометить запись открытой сессии или снять метку (`null`). Возвращает причину отказа. */
  onSetLabel: (entryId: string, label: string | null) => Promise<string | undefined>;
  /** Перейти к записи дерева. Ответ несёт текст реплики, если целью была она. */
  onNavigate: (request: SessionNavigateRequest) => Promise<NavigationOutcome>;
  onShowArchived: (archived: boolean) => void;
  translator: ScopedTranslator;
};

/** Занятая сессия выделяется акцентом: в списке из десятка это единственный способ найти живую. */
const phaseTone = (phase: Session["phase"]): BadgeTone => (phase === "idle" ? "neutral" : "accent");

export function SessionsView(props: SessionsViewProps) {
  const { state, translator } = props;
  const { t } = translator;
  const sessions = state.sessions;
  /** Сессия, чьё имя правят прямо сейчас, и черновик этого имени. */
  const [renaming, setRenaming] = useState<{ session: Session; title: string } | undefined>(
    undefined,
  );
  const [removing, setRemoving] = useState<Session | undefined>(undefined);

  /**
   * Пункты меню строки. Архивация и удаление у занятой сессии выключены здесь же, а не только
   * отказом демона: показать невозможное действие и объяснить отказ постфактум — худший из двух
   * способов сказать одно и то же (docs/sessions-and-projects.md).
   */
  const rowActions = (session: Session) => {
    const busy = session.phase !== "idle";

    return [
      {
        id: "rename",
        label: t("sessions.action.rename"),
        onSelect: () => setRenaming({ session, title: session.title ?? "" }),
      },
      session.archived
        ? {
            id: "restore",
            label: t("sessions.action.restore"),
            disabled: busy,
            onSelect: () => {
              void props.onUpdate(session.id, { archived: false, ...titleOf(session) });
            },
          }
        : {
            id: "archive",
            label: t("sessions.action.archive"),
            disabled: busy,
            onSelect: () => {
              void props.onUpdate(session.id, { archived: true, ...titleOf(session) });
            },
          },
      {
        id: "remove",
        label: t("sessions.action.remove"),
        tone: "danger" as const,
        disabled: busy,
        onSelect: () => setRemoving(session),
      },
    ];
  };

  return (
    <div className="sessions">
      <div className="sessions-head">
        <Heading level={1}>{t("page.sessions.title")}</Heading>
        <span className="sessions-head-actions">
          <Toggle
            checked={state.showArchived}
            onChange={props.onShowArchived}
            label={t("sessions.archived.show")}
          />
          <Button tone="accent" onClick={props.onStartCreating}>
            {t("sessions.new")}
          </Button>
        </span>
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
                  actions={
                    <Menu
                      label={t("sessions.actions", { name: session.title ?? session.id })}
                      trigger="…"
                      triggerLabel={t("sessions.actions", { name: session.title ?? session.id })}
                      compact
                      items={rowActions(session)}
                    />
                  }
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
            onSendMessage={props.onSendMessage}
            onInterrupt={props.onInterrupt}
            onFork={props.onFork}
            onCompact={props.onCompact}
            onSetLabel={props.onSetLabel}
            onNavigate={props.onNavigate}
            translator={translator}
          />
        )}
      </div>

      <Dialog
        open={renaming !== undefined}
        onClose={() => setRenaming(undefined)}
        title={t("sessions.rename.title")}
        footer={
          <>
            <Button onClick={() => setRenaming(undefined)}>{t("common.cancel")}</Button>
            <Button
              tone="accent"
              onClick={() => {
                if (renaming === undefined) {
                  return;
                }

                const title = renaming.title.trim();

                void props.onUpdate(renaming.session.id, {
                  archived: renaming.session.archived,
                  ...(title === "" ? {} : { title }),
                });
                setRenaming(undefined);
              }}
            >
              {t("sessions.rename.confirm")}
            </Button>
          </>
        }
      >
        <Field label={t("sessions.rename.field")} hint={t("sessions.rename.hint")}>
          {(control) => (
            <Input
              {...control}
              value={renaming?.title ?? ""}
              onChange={(title) =>
                setRenaming((current) => (current === undefined ? current : { ...current, title }))
              }
            />
          )}
        </Field>
      </Dialog>

      <ConfirmDialog
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={t("sessions.remove.title", { name: removing?.title ?? removing?.id ?? "" })}
        description={t("sessions.remove.hint")}
        confirmLabel={t("sessions.remove.confirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (removing !== undefined) {
            void props.onRemove(removing.id);
          }

          setRemoving(undefined);
        }}
      />
    </div>
  );
}

/** Имя в теле записи: тело заменяет запись целиком, и без имени оно бы его снимало. */
function titleOf(session: Session): { title?: string } {
  return session.title === undefined ? {} : { title: session.title };
}
