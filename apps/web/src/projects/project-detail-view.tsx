import type { Project } from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  EmptyState,
  Heading,
  Notice,
  Panel,
  Spinner,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import type { ReactNode } from "react";

export type ProjectDetailViewProps = {
  project?: Project;
  failure?: string;
  loaded: boolean;
  fileResources?: ReactNode;
  onBack: () => void;
  onNewSession: () => void;
  translator: ScopedTranslator;
};

export function ProjectDetailView({
  project,
  failure,
  fileResources,
  loaded,
  onBack,
  onNewSession,
  translator,
}: ProjectDetailViewProps) {
  const { t } = translator;

  if (project === undefined) {
    return (
      <div className="project-detail">
        <Button onClick={onBack}>{t("projects.back")}</Button>
        {!loaded ? (
          <Spinner label={t("state.loading")} />
        ) : failure === undefined ? (
          <EmptyState title={t("projects.notfound")} hint={t("projects.notfound.hint")} />
        ) : (
          <Notice tone="danger" title={t("projects.failed", { reason: failure })} />
        )}
      </div>
    );
  }

  return (
    <div className="project-detail">
      <div className="project-detail-topbar" role="toolbar" aria-label={t("page.projects.title")}>
        <Button onClick={onBack}>{t("projects.back")}</Button>
        <Button tone="accent" onClick={onNewSession}>
          {t("sessions.new")}
        </Button>
      </div>
      <Panel>
        <div className="project-detail-header">
          <div>
            <Heading level={1}>
              {project.ephemeral ? t("projects.ephemeral") : project.name}
            </Heading>
            <Code>{project.folder}</Code>
          </div>
          <Badge tone={project.availability === "available" ? "success" : "warning"}>
            {project.availability === "available"
              ? t("projects.available")
              : t("projects.availability.missing")}
          </Badge>
        </div>
        <div className="project-detail-summary">
          <Text tone="muted">{t("projects.sessions.count", { count: project.sessionCount })}</Text>
          {project.ephemeral ? (
            <Badge tone="neutral">{t("projects.ephemeral.mark")}</Badge>
          ) : undefined}
        </div>
      </Panel>
      {fileResources}
    </div>
  );
}
