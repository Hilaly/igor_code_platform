import { join } from "node:path";

import type { FileResourceKind, ProjectAvailability } from "@sovereign/protocol";

export type StandaloneResourceRoot = {
  key: string;
  source: "sovereign" | "agents";
  scope: "user" | "project";
  projectId?: string;
  kind: FileResourceKind;
  precedence: number;
  directory: string;
};

export type StandaloneResourceProject = {
  id: string;
  folder: string;
  archived: boolean;
};

export type StandaloneResourceRootsOptions = {
  dataDirectory: string;
  homeDirectory: string;
  projects: readonly StandaloneResourceProject[];
  availability: (project: StandaloneResourceProject) => ProjectAvailability;
};

export function standaloneResourceRoots(
  options: StandaloneResourceRootsOptions,
): StandaloneResourceRoot[] {
  const projectRoots = options.projects
    .filter((project) => !project.archived && options.availability(project) === "available")
    .flatMap((project): StandaloneResourceRoot[] => [
      {
        key: `project:${project.id}:agents:sovereign`,
        source: "sovereign",
        scope: "project",
        projectId: project.id,
        kind: "agent",
        precedence: 200,
        directory: join(project.folder, ".sovereign", "agents"),
      },
      {
        key: `project:${project.id}:skills:sovereign`,
        source: "sovereign",
        scope: "project",
        projectId: project.id,
        kind: "skill",
        precedence: 400,
        directory: join(project.folder, ".sovereign", "skills"),
      },
      {
        key: `project:${project.id}:skills:agents`,
        source: "agents",
        scope: "project",
        projectId: project.id,
        kind: "skill",
        precedence: 300,
        directory: join(project.folder, ".agents", "skills"),
      },
    ]);

  return [
    ...projectRoots,
    {
      key: "data:agents",
      source: "sovereign",
      scope: "user",
      kind: "agent",
      precedence: 100,
      directory: join(options.dataDirectory, "agents"),
    },
    {
      key: "data:skills",
      source: "sovereign",
      scope: "user",
      kind: "skill",
      precedence: 200,
      directory: join(options.dataDirectory, "skills"),
    },
    {
      key: "home:agents:skills",
      source: "agents",
      scope: "user",
      kind: "skill",
      precedence: 100,
      directory: join(options.homeDirectory, ".agents", "skills"),
    },
  ];
}
