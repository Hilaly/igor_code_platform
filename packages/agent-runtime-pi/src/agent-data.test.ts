import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderRuntimeContext } from "./agent-data.ts";

describe("the model-visible runtime context", () => {
  it("distinguishes the project, agent and Sovereign data directories", () => {
    assert.equal(
      renderRuntimeContext({
        cwd: `/tmp/project&<>"'`,
        agentPersonalDirectory: `/tmp/agent&<>"'`,
        sovereignDataDirectory: `/tmp/data&<>"'`,
      }),
      `<runtime_context>\n  <cwd>/tmp/project&amp;&lt;&gt;&quot;&apos;</cwd>\n  <agent_personal_directory>/tmp/agent&amp;&lt;&gt;&quot;&apos;</agent_personal_directory>\n  <sovereign_data_directory>/tmp/data&amp;&lt;&gt;&quot;&apos;</sovereign_data_directory>\n\n  <directory_guidance>\n    Work on the current project in cwd. Use it as the default location for project files and project-relative operations.\n    The agent personal directory contains this agent&apos;s definition and private persistent files, such as its own notes. Do not treat it as the project workspace.\n    The Sovereign data directory contains platform-managed shared data. Use it only when the task requires Sovereign resources or state; do not treat it as the current project.\n  </directory_guidance>\n</runtime_context>`,
    );
  });

  it("omits only the personal directory for an agent without one", () => {
    const rendered = renderRuntimeContext({
      cwd: "/tmp/project",
      sovereignDataDirectory: "/tmp/data",
    });

    assert.doesNotMatch(rendered, /agent_personal_directory/);
    assert.match(rendered, /<cwd>\/tmp\/project<\/cwd>/);
    assert.match(rendered, /<sovereign_data_directory>\/tmp\/data<\/sovereign_data_directory>/);
    assert.match(rendered, /<directory_guidance>/);
    assert.match(rendered, /Do not treat it as the project workspace/);
    assert.match(rendered, /do not treat it as the current project/);
    assert.equal(rendered.startsWith("<runtime_context>"), true);
    assert.equal(rendered.endsWith("</runtime_context>"), true);
  });
});
