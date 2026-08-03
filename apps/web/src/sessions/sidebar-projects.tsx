import type { Project, ProjectUpdate, Session, SessionUpdate } from "@sovereign/protocol";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Menu,
  Text,
  Tree,
  type ScopedTranslator,
  type TreeNode,
} from "@sovereign/ui-kit";
import { useEffect, useMemo, useState } from "react";

const expandedProjectsKey = "sovereign.sidebar.expanded-projects";

export type SidebarProjectsProps = {
  projects: Project[] | undefined;
  sessions: Session[] | undefined;
  selectedSessionId?: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  onOpenSession: (sessionId: string) => void;
  onNewSession: (projectId: string) => void;
  onUpdateProject: (projectId: string, update: ProjectUpdate) => void;
  onRemoveProject: (projectId: string) => void;
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

export function SidebarProjects(props: SidebarProjectsProps) {
  const { t } = props.translator;
  const [expanded, setExpanded] = useState(() => readExpanded(props.storage));
  const [renaming, setRenaming] = useState<RenameTarget | undefined>();
  const [removing, setRemoving] = useState<RemoveTarget | undefined>();
  const [name, setName] = useState("");
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

  const projectActions = (project: Project) => (
    <span className="sidebar-project-actions">
      <Button
        size="sm"
        iconOnly
        aria-label={t("sessions.new.in-project", { project: project.name })}
        title={t("sessions.new.in-project", { project: project.name })}
        disabled={project.availability !== "available"}
        onClick={() => props.onNewSession(project.id)}
      >
        +
      </Button>
      {project.ephemeral ? undefined : (
        <Menu
          label={t("projects.actions", { name: project.name })}
          trigger="…"
          triggerLabel={t("projects.actions", { name: project.name })}
          compact
          items={[
            {
              id: "rename",
              label: t("projects.action.rename"),
              onSelect: () => beginRename({ kind: "project", value: project }),
            },
            {
              id: "archive",
              label: t("projects.action.archive"),
              onSelect: () =>
                props.onUpdateProject(project.id, { name: project.name, archived: true }),
            },
            {
              id: "remove",
              label: t("projects.action.remove"),
              tone: "danger",
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
        trigger="…"
        triggerLabel={t("sessions.actions", { name: title })}
        compact
        items={[
          {
            id: "rename",
            label: t("sessions.action.rename"),
            onSelect: () => beginRename({ kind: "session", value: session }),
          },
          {
            id: "archive",
            label: t("sessions.action.archive"),
            disabled: session.phase !== "idle",
            onSelect: () =>
              void props.onUpdateSession(session.id, { ...sessionTitle(session), archived: true }),
          },
          {
            id: "remove",
            label: t("sessions.action.remove"),
            tone: "danger",
            disabled: session.phase !== "idle",
            onSelect: () => setRemoving({ kind: "session", value: session }),
          },
        ]}
      />
    );
  };

  const nodes: TreeNode[] = activeProjects.map((project) => ({
    id: `project:${project.id}`,
    label: project.ephemeral ? t("projects.ephemeral") : project.name,
    ...(project.availability === "missing"
      ? { badge: { tone: "warning" as const, text: t("projects.availability.missing") } }
      : {}),
    actions: projectActions(project),
    children: (props.sessions ?? [])
      .filter((session) => session.projectId === project.id && !session.archived)
      .map((session) => ({
        id: `session:${session.id}`,
        label: session.title ?? t("sessions.untitled"),
        actions: sessionActions(session),
      })),
  }));

  return (
    <>
      <Tree
        label={t("sidebar.projects")}
        nodes={nodes}
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
          if (!node.id.startsWith("session:")) return;
          const sessionId = node.id.slice("session:".length);
          const session = props.sessions?.find(({ id }) => id === sessionId);
          const project = activeProjects.find(({ id }) => id === session?.projectId);
          if (project?.availability === "available") props.onOpenSession(sessionId);
        }}
      />

      <Dialog
        open={renaming !== undefined}
        onClose={() => setRenaming(undefined)}
        title={
          renaming?.kind === "project" ? t("projects.rename.title") : t("sessions.rename.title")
        }
        footer={
          <>
            <Button onClick={() => setRenaming(undefined)}>{t("common.cancel")}</Button>
            <Button
              tone="accent"
              onClick={() => {
                if (renaming?.kind === "project") {
                  props.onUpdateProject(renaming.value.id, {
                    name: name.trim(),
                    archived: renaming.value.archived,
                  });
                } else if (renaming?.kind === "session") {
                  void props.onUpdateSession(renaming.value.id, {
                    archived: renaming.value.archived,
                    ...(name.trim() === "" ? {} : { title: name.trim() }),
                  });
                }
                setRenaming(undefined);
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
          if (removing?.kind === "project") props.onRemoveProject(removing.value.id);
          if (removing?.kind === "session") void props.onRemoveSession(removing.value.id);
          setRemoving(undefined);
        }}
      >
        {removing?.kind === "project" ? (
          <Text tone="muted">{t("projects.remove.folder")}</Text>
        ) : undefined}
      </ConfirmDialog>
    </>
  );
}
