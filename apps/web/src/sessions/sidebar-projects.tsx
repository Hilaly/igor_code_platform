import type { Project, ProjectUpdate, Session, SessionUpdate } from "@sovereign/protocol";
import {
  AddIcon,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  FolderIcon,
  FolderOpenIcon,
  Input,
  Menu,
  MoreIcon,
  Notice,
  Spinner,
  Text,
  Tree,
  TreeContextCard,
  TreeContextCardFact,
  TreeContextCardHeader,
  type ScopedTranslator,
  type TreeNode,
} from "@sovereign/ui-kit";
import { useEffect, useMemo, useState } from "react";

import { shortenPathMiddle } from "../projects/path-shorten.ts";

const expandedProjectsKey = "sovereign.sidebar.expanded-projects";
const sidebarPathLength = 20;

export type SidebarProjectsProps = {
  projects: Project[] | undefined;
  sessions: Session[] | undefined;
  projectsLoading?: boolean;
  projectsFailure?: string;
  sessionsLoading?: boolean;
  sessionsFailure?: string;
  selectedSessionId?: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  onOpenSession: (sessionId: string) => void;
  onNewSession: (projectId: string) => void;
  onUpdateProject: (projectId: string, update: ProjectUpdate) => Promise<string | undefined>;
  onRemoveProject: (projectId: string) => Promise<string | undefined>;
  onUpdateSession: (sessionId: string, update: SessionUpdate) => Promise<string | undefined>;
  onRemoveSession: (sessionId: string) => Promise<string | undefined>;
  translator: ScopedTranslator;
};

type RenameTarget = { kind: "project"; value: Project } | { kind: "session"; value: Session };
type RemoveTarget = RenameTarget;

function readExpanded(storage: Pick<Storage, "getItem">): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(expandedProjectsKey) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function sessionTitle(session: Session): { title?: string } {
  return session.title === undefined ? {} : { title: session.title };
}

function relativeAge(
  createdAt: string,
  now = Date.now(),
): { amount: number; unit: "seconds" | "minutes" | "hours" | "days" } {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return { amount: seconds, unit: "seconds" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { amount: minutes, unit: "minutes" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { amount: hours, unit: "hours" };
  return { amount: Math.floor(hours / 24), unit: "days" };
}

export function SidebarProjects(props: SidebarProjectsProps) {
  const { t } = props.translator;
  const [expanded, setExpanded] = useState(() => readExpanded(props.storage));
  const [renaming, setRenaming] = useState<RenameTarget | undefined>();
  const [removing, setRemoving] = useState<RemoveTarget | undefined>();
  const [name, setName] = useState("");
  const [pendingAction, setPendingAction] = useState<string | undefined>();
  const [actionFailure, setActionFailure] = useState<string | undefined>();
  const activeProjects = useMemo(
    () => (props.projects ?? []).filter((project) => !project.archived),
    [props.projects],
  );
  const activeIds = useMemo(() => new Set(activeProjects.map(({ id }) => id)), [activeProjects]);
  const selectedProjectId = props.sessions?.find(
    (session) => session.id === props.selectedSessionId,
  )?.projectId;

  useEffect(() => {
    setExpanded((current) => {
      const next = current.filter((id) => activeIds.has(id));

      if (selectedProjectId !== undefined && activeIds.has(selectedProjectId)) {
        next.push(selectedProjectId);
      }

      const unique = [...new Set(next)];
      props.storage.setItem(expandedProjectsKey, JSON.stringify(unique));
      return unique;
    });
  }, [activeIds, props.storage, selectedProjectId]);

  const beginRename = (target: RenameTarget) => {
    setRenaming(target);
    setName(target.kind === "project" ? target.value.name : (target.value.title ?? ""));
  };

  const runAction = async (
    key: string,
    action: () => Promise<string | undefined>,
  ): Promise<string | undefined> => {
    if (pendingAction !== undefined) return undefined;
    setPendingAction(key);
    setActionFailure(undefined);
    try {
      const reason = await action();
      if (reason !== undefined) setActionFailure(reason);
      return reason;
    } finally {
      setPendingAction(undefined);
    }
  };

  const projectActions = (project: Project) => (
    <span className="sidebar-project-actions">
      {/* Тихий регистр, как у соседнего «ещё»: постоянная капсула у одной кнопки из двух читалась как
          контрол другой природы. */}
      <Button
        tone="quiet"
        size="sm"
        iconOnly
        aria-label={t("sessions.new.in-project", { project: project.name })}
        title={t("sessions.new.in-project", { project: project.name })}
        disabled={project.availability !== "available"}
        onClick={() => props.onNewSession(project.id)}
      >
        <AddIcon size="sm" />
      </Button>
      {project.ephemeral ? undefined : (
        <Menu
          label={t("projects.actions", { name: project.name })}
          trigger={<MoreIcon size="sm" />}
          triggerLabel={t("projects.actions", { name: project.name })}
          compact
          openOnHover
          items={[
            {
              id: "rename",
              label: t("projects.action.rename"),
              disabled: pendingAction !== undefined,
              onSelect: () => beginRename({ kind: "project", value: project }),
            },
            {
              id: "archive",
              label: t("projects.action.archive"),
              disabled: pendingAction !== undefined,
              onSelect: () =>
                void runAction(`archive-project:${project.id}`, () =>
                  props.onUpdateProject(project.id, { name: project.name, archived: true }),
                ),
            },
            {
              id: "remove",
              label: t("projects.action.remove"),
              tone: "danger",
              disabled: pendingAction !== undefined,
              onSelect: () => setRemoving({ kind: "project", value: project }),
            },
          ]}
        />
      )}
    </span>
  );

  const sessionActions = (session: Session) => {
    const title = session.title ?? t("sessions.untitled");
    return (
      <Menu
        label={t("sessions.actions", { name: title })}
        trigger={<MoreIcon size="sm" />}
        triggerLabel={t("sessions.actions", { name: title })}
        compact
        openOnHover
        items={[
          {
            id: "rename",
            label: t("sessions.action.rename"),
            disabled: pendingAction !== undefined,
            onSelect: () => beginRename({ kind: "session", value: session }),
          },
          {
            id: "archive",
            label: t("sessions.action.archive"),
            disabled: session.phase !== "idle" || pendingAction !== undefined,
            onSelect: () =>
              void runAction(`archive-session:${session.id}`, () =>
                props.onUpdateSession(session.id, { ...sessionTitle(session), archived: true }),
              ),
          },
          {
            id: "remove",
            label: t("sessions.action.remove"),
            tone: "danger",
            disabled: session.phase !== "idle" || pendingAction !== undefined,
            onSelect: () => setRemoving({ kind: "session", value: session }),
          },
        ]}
      />
    );
  };

  const nodes: TreeNode[] = activeProjects.map((project) => ({
    id: `project:${project.id}`,
    label: project.ephemeral ? t("projects.ephemeral") : project.name,
    title: project.ephemeral ? t("projects.ephemeral") : project.name,
    ...(project.availability === "missing"
      ? { badge: { tone: "warning" as const, text: t("projects.availability.missing") } }
      : {}),
    actions: projectActions(project),
    disclosureIcon: (expanded) =>
      expanded ? <FolderOpenIcon size="sm" /> : <FolderIcon size="sm" />,
    context: (
      <TreeContextCard>
        <TreeContextCardHeader
          icon={<FolderIcon size="sm" />}
          aside={
            project.availability === "missing" ? t("projects.availability.missing") : undefined
          }
        >
          {project.ephemeral ? t("projects.ephemeral") : project.name}
        </TreeContextCardHeader>
        <TreeContextCardFact>
          {t("projects.sessions.active", { count: project.sessionCount })}
        </TreeContextCardFact>
        <TreeContextCardFact icon={<FolderIcon size="sm" />} title={project.folder}>
          {shortenPathMiddle(project.folder, sidebarPathLength)}
        </TreeContextCardFact>
      </TreeContextCard>
    ),
    children: (props.sessions ?? [])
      // Скрытая сессия жива и открывается по прямому адресу, но в дереве ей не место: её завёл не
      // человек, а плагин для своей работы (docs/sessions-and-projects.md).
      .filter((session) => session.projectId === project.id && !session.archived && !session.hidden)
      .map((session) => ({
        id: `session:${session.id}`,
        label: session.title ?? t("sessions.untitled"),
        title: session.title ?? t("sessions.untitled"),
        actions: sessionActions(session),
        context: (
          <TreeContextCard>
            <TreeContextCardHeader>{session.title ?? t("sessions.untitled")}</TreeContextCardHeader>
            <TreeContextCardFact>
              {t("sessions.project", { project: project.name })}
            </TreeContextCardFact>
            <TreeContextCardFact>
              {t("sessions.created", {
                age: t(`duration.${relativeAge(session.createdAt).unit}`, {
                  count: relativeAge(session.createdAt).amount,
                }),
              })}
            </TreeContextCardFact>
            <TreeContextCardFact icon={<FolderIcon size="sm" />} title={project.folder}>
              {shortenPathMiddle(project.folder, sidebarPathLength)}
            </TreeContextCardFact>
          </TreeContextCard>
        ),
      })),
  }));

  return (
    <>
      {actionFailure === undefined ? undefined : (
        <Notice tone="danger" title={t("projects.write.failed", { reason: actionFailure })} />
      )}
      {props.projectsFailure === undefined ||
      props.projectsFailure === actionFailure ? undefined : (
        <Notice tone="danger" title={t("projects.failed", { reason: props.projectsFailure })} />
      )}
      {props.sessionsFailure === undefined ? undefined : (
        <Notice tone="danger" title={t("sessions.failed", { reason: props.sessionsFailure })} />
      )}
      {props.projectsLoading || props.sessionsLoading ? (
        <Spinner label={t("state.loading")} />
      ) : null}
      <Tree
        label={t("sidebar.projects")}
        nodes={nodes}
        actionsVisibility="interaction"
        disclosureAlignment="label"
        selectedId={
          props.selectedSessionId === undefined ? undefined : `session:${props.selectedSessionId}`
        }
        expandedIds={expanded.map((id) => `project:${id}`)}
        onExpandedChange={(ids) => {
          const next = ids
            .filter((id) => id.startsWith("project:"))
            .map((id) => id.slice("project:".length));
          setExpanded(next);
          props.storage.setItem(expandedProjectsKey, JSON.stringify(next));
        }}
        toggleLabel={(node, isExpanded) =>
          t(isExpanded ? "sidebar.project.collapse" : "sidebar.project.expand", {
            project: node.label,
          })
        }
        onSelect={(node) => {
          if (node.id.startsWith("project:")) {
            const projectNodeId = node.id;
            const nextExpanded = expanded.includes(projectNodeId.slice("project:".length))
              ? expanded.filter((id) => `project:${id}` !== projectNodeId)
              : [...expanded, projectNodeId.slice("project:".length)];
            setExpanded(nextExpanded);
            props.storage.setItem(expandedProjectsKey, JSON.stringify(nextExpanded));
            return;
          }

          if (!node.id.startsWith("session:")) return;
          const sessionId = node.id.slice("session:".length);
          const session = props.sessions?.find(({ id }) => id === sessionId);
          const project = activeProjects.find(({ id }) => id === session?.projectId);
          if (project?.availability === "available") props.onOpenSession(sessionId);
        }}
      />

      <Dialog
        open={renaming !== undefined}
        onClose={() => {
          if (pendingAction === undefined) setRenaming(undefined);
        }}
        title={
          renaming?.kind === "project" ? t("projects.rename.title") : t("sessions.rename.title")
        }
        footer={
          <>
            <Button onClick={() => setRenaming(undefined)} disabled={pendingAction !== undefined}>
              {t("common.cancel")}
            </Button>
            <Button
              tone="accent"
              disabled={pendingAction !== undefined}
              busy={pendingAction !== undefined}
              onClick={() => {
                if (renaming?.kind === "project") {
                  const target = renaming;
                  void runAction(`rename-project:${target.value.id}`, () =>
                    props.onUpdateProject(target.value.id, {
                      name: name.trim(),
                      archived: target.value.archived,
                    }),
                  ).then((reason) => {
                    if (reason === undefined) setRenaming(undefined);
                  });
                } else if (renaming?.kind === "session") {
                  const target = renaming;
                  void runAction(`rename-session:${target.value.id}`, () =>
                    props.onUpdateSession(target.value.id, {
                      archived: target.value.archived,
                      ...(name.trim() === "" ? {} : { title: name.trim() }),
                    }),
                  ).then((reason) => {
                    if (reason === undefined) setRenaming(undefined);
                  });
                }
              }}
            >
              {renaming?.kind === "project"
                ? t("projects.rename.confirm")
                : t("sessions.rename.confirm")}
            </Button>
          </>
        }
      >
        <Field
          label={
            renaming?.kind === "project" ? t("projects.field.name") : t("sessions.rename.field")
          }
        >
          {(control) => <Input {...control} value={name} onChange={setName} />}
        </Field>
      </Dialog>

      <ConfirmDialog
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={
          removing?.kind === "project"
            ? t("projects.remove.title", { name: removing.value.name })
            : t("sessions.remove.title", {
                name: removing?.value.title ?? removing?.value.id ?? "",
              })
        }
        description={
          removing?.kind === "project"
            ? t("projects.remove.sessions", { count: removing.value.sessionCount })
            : t("sessions.remove.hint")
        }
        confirmLabel={
          removing?.kind === "project" ? t("projects.remove.confirm") : t("sessions.remove.confirm")
        }
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (removing?.kind === "project") {
            const target = removing;
            void runAction(`remove-project:${target.value.id}`, () =>
              props.onRemoveProject(target.value.id),
            ).then((reason) => {
              if (reason === undefined) setRemoving(undefined);
            });
          }
          if (removing?.kind === "session") {
            const target = removing;
            void runAction(`remove-session:${target.value.id}`, () =>
              props.onRemoveSession(target.value.id),
            ).then((reason) => {
              if (reason === undefined) setRemoving(undefined);
            });
          }
        }}
        pending={pendingAction !== undefined}
      >
        {removing?.kind === "project" ? (
          <Text tone="muted">{t("projects.remove.folder")}</Text>
        ) : undefined}
      </ConfirmDialog>
    </>
  );
}
