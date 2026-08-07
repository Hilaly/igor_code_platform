import type { Project } from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  EmptyState,
  Notice,
  SettingsRow,
  Spinner,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import type { ReactNode } from "react";

export type ProjectDetailViewProps = {
  project?: Project;
  failure?: string;
  loaded: boolean;
  headingLevel?: 1 | 2;
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
      <div className="project-detail-rows">
        <SettingsRow
          label={project.ephemeral ? t("projects.ephemeral") : project.name}
          description={<Code>{project.folder}</Code>}
        >
          <Badge tone={project.availability === "available" ? "success" : "warning"}>
            {project.availability === "available"
              ? t("projects.available")
              : t("projects.availability.missing")}
          </Badge>
        </SettingsRow>
        <SettingsRow label={t("projects.sessions.count", { count: project.sessionCount })}>
          {project.ephemeral ? (
            <Badge tone="neutral">{t("projects.ephemeral.mark")}</Badge>
          ) : (
            <Text tone="muted">{project.sessionCount}</Text>
          )}
        </SettingsRow>
      </div>
      {fileResources}
    </div>
  );
}
