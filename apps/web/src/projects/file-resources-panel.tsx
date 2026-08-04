import type {
  FileResourceDiagnostic,
  FileResourceKind,
  FileResourceSummary,
} from "@sovereign/protocol";
import {
  Badge,
  Code,
  EmptyState,
  Heading,
  ListRow,
  Notice,
  Spinner,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useId } from "react";

import type { FileResourcesState } from "./file-resources-state.ts";

export type FileResourcesPanelProps = {
  state: FileResourcesState;
  translator: ScopedTranslator;
};

type Problem =
  | {
      category: "error" | "warning";
      diagnostic: FileResourceDiagnostic;
      resource?: FileResourceSummary;
    }
  | { category: "state"; resource: FileResourceSummary };

const pathOf = (problem: Problem): string =>
  problem.category === "state" ? problem.resource.path : problem.diagnostic.path;

function problemsOf(state: FileResourcesState): Problem[] {
  const snapshot = state.snapshot;
  if (snapshot === undefined) return [];

  const diagnostics: Problem[] = snapshot.diagnostics.map((diagnostic) => {
    const resource = snapshot.resources.find(({ path }) => path === diagnostic.path);

    return {
      category: diagnostic.severity,
      diagnostic,
      ...(resource === undefined ? {} : { resource }),
    };
  });
  const states: Problem[] = snapshot.resources
    .filter(({ state }) => state !== "active")
    .map((resource) => ({ category: "state", resource }));
  const categoryOrder = { error: 0, warning: 1, state: 2 } as const;

  return [...diagnostics, ...states].sort((left, right) => {
    const category = categoryOrder[left.category] - categoryOrder[right.category];
    if (category !== 0) return category;

    return pathOf(left).localeCompare(pathOf(right));
  });
}

export function FileResourcesPanel({ state, translator }: FileResourcesPanelProps) {
  const { t } = translator;
  const headingId = useId();

  return (
    <section className="project-resources" aria-labelledby={headingId}>
      <hgroup id={headingId}>
        <Heading level={2}>{t("projects.resources.title")}</Heading>
      </hgroup>
      {state.snapshot === undefined ? (
        state.failure === undefined ? (
          <Spinner label={t("projects.resources.loading")} />
        ) : (
          <Notice tone="danger" title={t("projects.resources.failed", { reason: state.failure })} />
        )
      ) : (
        <ResourcesContent state={state} translator={translator} />
      )}
    </section>
  );
}

function ResourcesContent({ state, translator }: FileResourcesPanelProps) {
  const snapshot = state.snapshot;
  if (snapshot === undefined) return null;
  const { t } = translator;
  const active = snapshot.resources.filter(
    ({ state: resourceState }) => resourceState === "active",
  );
  const problems = problemsOf(state);
  const problemsHeadingId = useId();

  return (
    <>
      {state.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("projects.resources.failed", { reason: state.failure })} />
      )}
      {state.stale ? <Notice tone="warning" title={t("projects.resources.stale")} /> : undefined}
      <div className="project-resources-counts">
        <Text>
          {t("projects.resources.agents.count", {
            count: active.filter(({ kind }) => kind === "agent").length,
          })}
        </Text>
        <Text>
          {t("projects.resources.skills.count", {
            count: active.filter(({ kind }) => kind === "skill").length,
          })}
        </Text>
      </div>
      <section className="project-resources-problems" aria-labelledby={problemsHeadingId}>
        <hgroup id={problemsHeadingId}>
          <Heading level={3}>{t("projects.resources.problems.title")}</Heading>
        </hgroup>
        {problems.length === 0 ? (
          <EmptyState title={t("projects.resources.problems.empty")} />
        ) : (
          <ul className="projects-list" aria-label={t("projects.resources.problems.label")}>
            {problems.map((problem, index) => (
              <ProblemRow
                key={`${problem.category}:${pathOf(problem)}:${String(index)}`}
                problem={problem}
                translator={translator}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ProblemRow({ problem, translator }: { problem: Problem; translator: ScopedTranslator }) {
  const { t } = translator;
  const diagnostic = problem.category === "state" ? undefined : problem.diagnostic;
  const resource = problem.resource;
  const kind = diagnostic?.kind ?? resource?.kind;
  const path = diagnostic?.path ?? resource?.path ?? "";
  const title =
    diagnostic === undefined
      ? t(`projects.resources.state.${resource?.state ?? "invalid"}`)
      : t(`projects.resources.severity.${diagnostic.severity}`);

  return (
    <ListRow>
      <div className="project-resource-problem">
        <div className="project-resource-problem-head">
          <Badge tone={problem.category === "error" ? "danger" : "warning"}>{title}</Badge>
          <Text>
            {kind === undefined ? t("projects.resources.kind.unknown") : kindName(kind, t)}
          </Text>
          <Code>{path}</Code>
        </div>
        {resource === undefined ? undefined : (
          <Text tone="muted">
            {t("projects.resources.origin", {
              source: resource.source,
              ownership: t(`projects.resources.ownership.${resource.ownership}`),
              scope: t(`projects.resources.scope.${resource.scope}`),
            })}
          </Text>
        )}
        {diagnostic === undefined ? undefined : <Text>{diagnostic.message}</Text>}
      </div>
    </ListRow>
  );
}

function kindName(kind: FileResourceKind, t: ScopedTranslator["t"]): string {
  return t(`projects.resources.kind.${kind}`);
}
