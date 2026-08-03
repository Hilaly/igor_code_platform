import type { Project, Session } from "@sovereign/protocol";
import {
  ConfirmDialog,
  EmptyState,
  Heading,
  List,
  ListRow,
  Menu,
  Notice,
  Spinner,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useMemo, useState } from "react";

export type ArchiveSessionsViewProps = {
  sessions: Session[] | undefined;
  projects: Project[] | undefined;
  loaded: boolean;
  failure?: string;
  onOpen: (sessionId: string) => void;
  onRestore: (session: Session) => Promise<string | undefined>;
  onRemove: (sessionId: string) => Promise<string | undefined>;
  translator: ScopedTranslator;
};

export function ArchiveSessionsView({
  sessions,
  projects,
  loaded,
  failure,
  onOpen,
  onRestore,
  onRemove,
  translator,
}: ArchiveSessionsViewProps) {
  const { t } = translator;
  const [removing, setRemoving] = useState<Session | undefined>();
  const [pendingAction, setPendingAction] = useState<string | undefined>();
  const [actionFailure, setActionFailure] = useState<string | undefined>();
  const projectNames = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project.name])),
    [projects],
  );
  const grouped = useMemo(() => {
    const groups = new Map<string, Session[]>();

    for (const session of sessions ?? []) {
      const current = groups.get(session.projectId) ?? [];
      current.push(session);
      groups.set(session.projectId, current);
    }

    return [...groups.entries()];
  }, [sessions]);

  const runAction = async (
    key: string,
    action: () => Promise<string | undefined>,
  ): Promise<void> => {
    setPendingAction(key);
    setActionFailure(undefined);

    try {
      const reason = await action();
      if (reason !== undefined) {
        setActionFailure(reason);
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <div className="sessions archive-sessions">
      <Heading level={1}>{t("sessions.archive.title")}</Heading>
      {actionFailure === undefined ? undefined : (
        <Notice tone="danger" title={t("sessions.failed", { reason: actionFailure })} />
      )}
      {failure === undefined ? undefined : (
        <Notice tone="danger" title={t("sessions.failed", { reason: failure })} />
      )}
      {!loaded ? (
        <Spinner label={t("state.loading")} />
      ) : grouped.length === 0 ? (
        <EmptyState title={t("sessions.archive.empty")} hint={t("sessions.archive.empty.hint")} />
      ) : (
        <div className="archive-sessions-groups">
          {grouped.map(([projectId, projectSessions]) => (
            <section key={projectId} className="archive-sessions-group">
              <Heading level={2}>{projectNames.get(projectId) ?? projectId}</Heading>
              <List>
                {projectSessions.map((session) => (
                  <ListRow
                    key={session.id}
                    onSelect={() => onOpen(session.id)}
                    actions={
                      <Menu
                        label={t("sessions.actions", { name: session.title ?? session.id })}
                        trigger="…"
                        triggerLabel={t("sessions.actions", { name: session.title ?? session.id })}
                        compact
                        items={[
                          {
                            id: "restore",
                            label: t("sessions.action.restore"),
                            disabled: pendingAction !== undefined,
                            onSelect: () =>
                              void runAction(`restore:${session.id}`, () => onRestore(session)),
                          },
                          {
                            id: "remove",
                            label: t("sessions.action.remove"),
                            tone: "danger",
                            disabled: pendingAction !== undefined,
                            onSelect: () => setRemoving(session),
                          },
                        ]}
                      />
                    }
                  >
                    <span className="sessions-row">
                      <span className="sessions-row-facts">
                        <Text>{session.title ?? t("sessions.untitled")}</Text>
                        <Text tone="muted">{session.folder}</Text>
                      </span>
                    </span>
                  </ListRow>
                ))}
              </List>
            </section>
          ))}
        </div>
      )}
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
            const target = removing;
            void runAction(`remove:${target.id}`, () => onRemove(target.id)).then(() =>
              setRemoving(undefined),
            );
          }
        }}
        pending={pendingAction === (removing === undefined ? undefined : `remove:${removing.id}`)}
      />
    </div>
  );
}
