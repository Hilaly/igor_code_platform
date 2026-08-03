import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  projectAgentsPath,
  projectFileResourcesPath,
  type FileResourceDiagnostic,
  type FileResourceSummary,
  type FileResourcesSnapshot,
} from "./index.ts";

describe("file resource wire contract", () => {
  it("uses project-scoped paths and keeps resource diagnostics in one revision", () => {
    assert.equal(projectAgentsPath("p/1"), "/api/projects/p%2F1/agents");
    assert.equal(projectFileResourcesPath("p/1"), "/api/projects/p%2F1/file-resources");

    const diagnostic: FileResourceDiagnostic = {
      severity: "error",
      code: "invalid-frontmatter",
      message: "name is required",
      path: "/plugins/github/skills/review/SKILL.md",
      kind: "skill",
    };
    const resource: FileResourceSummary = {
      kind: "skill",
      name: "review",
      id: "github.review",
      path: "/plugins/github/skills/review/SKILL.md",
      source: "builtin",
      ownership: "plugin",
      scope: "built-in",
      pluginKey: "builtin:github",
      state: "active",
    };
    const snapshot: FileResourcesSnapshot = {
      revision: 3,
      resources: [resource],
      diagnostics: [diagnostic],
    };

    assert.equal(snapshot.resources[0]?.ownership, "plugin");
  });
});
