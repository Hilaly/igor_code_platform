import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderSkillCatalogue, type AgentSkill } from "./skills.ts";

describe("the model-visible skill catalogue", () => {
  it("escapes all XML metacharacters", () => {
    assert.equal(
      renderSkillCatalogue([
        {
          name: "review&check",
          description: "Use <carefully>",
          location: `/tmp/a"b'c/SKILL.md`,
        },
      ]),
      `<available_skills>\n  <skill>\n    <name>review&amp;check</name>\n    <description>Use &lt;carefully&gt;</description>\n    <location>/tmp/a&quot;b&apos;c/SKILL.md</location>\n  </skill>\n</available_skills>`,
    );
  });

  it("renders model-invocable skills in deterministic order without mutating the input", () => {
    const deploy: AgentSkill = {
      name: "deploy",
      description: "Deploy the change",
      location: "/tmp/deploy/SKILL.md",
    };
    const hidden: AgentSkill = {
      name: "internal",
      description: "Only a person may invoke this",
      location: "/tmp/internal/SKILL.md",
      disableModelInvocation: true,
    };
    const review: AgentSkill = {
      name: "code-review",
      description: "Review the change",
      location: "/tmp/code-review/SKILL.md",
    };
    const skills = [deploy, hidden, review];

    assert.equal(
      renderSkillCatalogue(skills),
      `<available_skills>\n  <skill>\n    <name>code-review</name>\n    <description>Review the change</description>\n    <location>/tmp/code-review/SKILL.md</location>\n  </skill>\n  <skill>\n    <name>deploy</name>\n    <description>Deploy the change</description>\n    <location>/tmp/deploy/SKILL.md</location>\n  </skill>\n</available_skills>`,
    );
    assert.deepEqual(skills, [deploy, hidden, review]);
  });

  it("omits the catalogue wrapper when no skills are visible", () => {
    assert.equal(renderSkillCatalogue([]), "");
    assert.equal(
      renderSkillCatalogue([
        {
          name: "internal",
          description: "Only a person may invoke this",
          location: "/tmp/internal/SKILL.md",
          disableModelInvocation: true,
        },
      ]),
      "",
    );
  });
});
