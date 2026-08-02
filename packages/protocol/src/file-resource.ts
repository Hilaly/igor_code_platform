/**
 * Файловые агенты и скилы в контексте проекта. Снимок содержит и применимые определения, и
 * локальные проблемы одного атомарного пересканирования (docs/plugins.md).
 */

export type FileResourceKind = "agent" | "skill";

export type FileResourceState = "active" | "shadowed" | "switched-off" | "invalid";

export type FileResourceDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;
  kind?: FileResourceKind;
  id?: string;
};

export type FileResourceSummary = {
  kind: FileResourceKind;
  name?: string;
  id?: string;
  ownership: "standalone" | "plugin";
  scope: "built-in" | "user" | "project";
  source: string;
  path: string;
  state: FileResourceState;
  pluginKey?: string;
  description?: string;
};

export type FileResourcesSnapshot = {
  revision: number;
  resources: FileResourceSummary[];
  diagnostics: FileResourceDiagnostic[];
};
