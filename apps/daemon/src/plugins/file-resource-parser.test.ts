import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentFile, parseSkillFile } from "./file-resource-parser.ts";

function assertInvalid(
  parsed: ReturnType<typeof parseAgentFile> | ReturnType<typeof parseSkillFile>,
  code: string,
  path: string,
): void {
  assert.equal(parsed.kind, "invalid");
  if (parsed.kind === "invalid") {
    assert.equal(parsed.diagnostics.length, 1);
    assert.deepEqual(
      {
        severity: parsed.diagnostics[0]?.severity,
        code: parsed.diagnostics[0]?.code,
        path: parsed.diagnostics[0]?.path,
        messageType: typeof parsed.diagnostics[0]?.message,
      },
      { severity: "error", code, path, messageType: "string" },
    );
  }
}

describe("parseAgentFile", () => {
  const path = "/agents/code/AGENT.md";

  it("parses selectors, thinking level, instructions, and ignores unknown fields", () => {
    const parsed = parseAgentFile({
      path,
      directoryName: "code",
      text: `---
name: code
description: Works with code
unknown-client-field: ignored
tools:
  include: ["*"]
skills:
  include: ["review-*"]
  exclude: ["*-unsafe"]
thinking-level: medium
---
Read before changing files.
`,
    });

    assert.equal(parsed.kind, "valid");
    if (parsed.kind === "valid") {
      assert.deepEqual(parsed.definition, {
        kind: "agent",
        name: "code",
        description: "Works with code",
        instructions: "Read before changing files.",
        tools: { include: ["*"], exclude: [] },
        skills: { include: ["review-*"], exclude: ["*-unsafe"] },
        thinkingLevel: "medium",
      });
      assert.deepEqual(parsed.diagnostics, []);
    }
  });

  it("uses empty selectors when tools and skills are absent", () => {
    const parsed = parseAgentFile({
      path,
      directoryName: "code",
      text: `---
name: code
description: Works with code
---
Do the work.
`,
    });

    assert.equal(parsed.kind, "valid");
    if (parsed.kind === "valid") {
      assert.deepEqual(parsed.definition.tools, { include: [], exclude: [] });
      assert.deepEqual(parsed.definition.skills, { include: [], exclude: [] });
    }
  });

  it("reports malformed YAML without throwing", () => {
    assertInvalid(
      parseAgentFile({ path, directoryName: "code", text: "---\nname: [code\n---\nBody\n" }),
      "invalid-frontmatter",
      path,
    );
  });

  it("rejects repeated YAML keys", () => {
    assertInvalid(
      parseAgentFile({
        path,
        directoryName: "code",
        text: "---\nname: code\nname: other\ndescription: Code\n---\nBody\n",
      }),
      "invalid-frontmatter",
      path,
    );
  });

  it("rejects a name different from its directory", () => {
    assertInvalid(
      parseAgentFile({
        path,
        directoryName: "code",
        text: "---\nname: other\ndescription: Code\n---\nBody\n",
      }),
      "name-directory-mismatch",
      path,
    );
  });

  it("rejects empty instructions", () => {
    assertInvalid(
      parseAgentFile({
        path,
        directoryName: "code",
        text: "---\nname: code\ndescription: Code\n---\n   \n",
      }),
      "missing-instructions",
      path,
    );
  });

  it("rejects an unsupported thinking level", () => {
    assertInvalid(
      parseAgentFile({
        path,
        directoryName: "code",
        text: "---\nname: code\ndescription: Code\nthinking-level: enormous\n---\nBody\n",
      }),
      "invalid-thinking-level",
      path,
    );
  });

  it("rejects malformed selectors", () => {
    assertInvalid(
      parseAgentFile({
        path,
        directoryName: "code",
        text: "---\nname: code\ndescription: Code\ntools:\n  include: '*'\n---\nBody\n",
      }),
      "invalid-selector",
      path,
    );
  });
});

describe("parseSkillFile", () => {
  const path = "/skills/code_review/SKILL.md";

  it("normalizes supported metadata and warns about a portable underscore", () => {
    const parsed = parseSkillFile({
      path,
      directoryName: "code_review",
      text: `---
name: code_review
description: Review a change
license: MIT
compatibility: Requires git
metadata:
  author: sovereign
allowed-tools: read bash
disable-model-invocation: false
future-field: ignored
---
Follow the review checklist.
`,
    });

    assert.equal(parsed.kind, "valid");
    if (parsed.kind === "valid") {
      assert.deepEqual(parsed.definition, {
        kind: "skill",
        name: "code_review",
        description: "Review a change",
        location: "/skills/code_review/SKILL.md",
        license: "MIT",
        compatibility: "Requires git",
        metadata: { author: "sovereign" },
        allowedTools: ["read", "bash"],
        disableModelInvocation: false,
      });
      assert.equal(parsed.diagnostics[0]?.code, "nonstandard-underscore");
      assert.equal(parsed.diagnostics[0]?.severity, "warning");
    }
  });

  it("defaults optional metadata and model invocation", () => {
    const parsed = parseSkillFile({
      path: "/skills/review/SKILL.md",
      directoryName: "review",
      text: "---\nname: review\ndescription: Review code\n---\nChecklist\n",
    });

    assert.equal(parsed.kind, "valid");
    if (parsed.kind === "valid") {
      assert.equal(parsed.definition.disableModelInvocation, false);
      assert.equal(parsed.definition.allowedTools, undefined);
      assert.equal(parsed.definition.metadata, undefined);
    }
  });

  for (const [label, name] of [
    ["longer than 64 characters", "a".repeat(65)],
    ["with a leading hyphen", "-review"],
    ["with a trailing hyphen", "review-"],
    ["with a doubled hyphen", "code--review"],
  ] satisfies [string, string][]) {
    it(`rejects a skill name ${label}`, () => {
      assertInvalid(
        parseSkillFile({
          path: `/skills/${name}/SKILL.md`,
          directoryName: name,
          text: `---\nname: ${name}\ndescription: Review code\n---\nChecklist\n`,
        }),
        "invalid-name",
        `/skills/${name}/SKILL.md`,
      );
    });
  }

  it("rejects a missing frontmatter delimiter", () => {
    assertInvalid(
      parseSkillFile({ path, directoryName: "code_review", text: "name: code_review\n" }),
      "invalid-frontmatter",
      path,
    );
  });

  it("requires a description", () => {
    assertInvalid(
      parseSkillFile({
        path: "/skills/review/SKILL.md",
        directoryName: "review",
        text: "---\nname: review\n---\nChecklist\n",
      }),
      "missing-description",
      "/skills/review/SKILL.md",
    );
  });

  it("requires the skill name to match its directory", () => {
    assertInvalid(
      parseSkillFile({
        path: "/skills/review/SKILL.md",
        directoryName: "review",
        text: "---\nname: other\ndescription: Review\n---\nChecklist\n",
      }),
      "name-directory-mismatch",
      "/skills/review/SKILL.md",
    );
  });

  it("accepts description and compatibility at their maximum lengths", () => {
    const parsed = parseSkillFile({
      path: "/skills/review/SKILL.md",
      directoryName: "review",
      text: `---\nname: review\ndescription: ${"a".repeat(1_024)}\ncompatibility: ${"b".repeat(500)}\n---\nChecklist\n`,
    });

    assert.equal(parsed.kind, "valid");
  });

  it("limits description to 1024 characters", () => {
    assertInvalid(
      parseSkillFile({
        path: "/skills/review/SKILL.md",
        directoryName: "review",
        text: `---\nname: review\ndescription: ${"a".repeat(1025)}\n---\nChecklist\n`,
      }),
      "invalid-description",
      "/skills/review/SKILL.md",
    );
  });

  it("limits compatibility to 500 characters", () => {
    assertInvalid(
      parseSkillFile({
        path: "/skills/review/SKILL.md",
        directoryName: "review",
        text: `---\nname: review\ndescription: Review\ncompatibility: ${"a".repeat(501)}\n---\nChecklist\n`,
      }),
      "invalid-compatibility",
      "/skills/review/SKILL.md",
    );
  });

  it("requires metadata values to be strings", () => {
    assertInvalid(
      parseSkillFile({
        path: "/skills/review/SKILL.md",
        directoryName: "review",
        text: "---\nname: review\ndescription: Review\nmetadata:\n  attempts: 2\n---\nChecklist\n",
      }),
      "invalid-metadata",
      "/skills/review/SKILL.md",
    );
  });

  it("requires allowed-tools to be a string", () => {
    assertInvalid(
      parseSkillFile({
        path: "/skills/review/SKILL.md",
        directoryName: "review",
        text: "---\nname: review\ndescription: Review\nallowed-tools: [read]\n---\nChecklist\n",
      }),
      "invalid-allowed-tools",
      "/skills/review/SKILL.md",
    );
  });

  it("requires disable-model-invocation to be boolean", () => {
    assertInvalid(
      parseSkillFile({
        path: "/skills/review/SKILL.md",
        directoryName: "review",
        text: "---\nname: review\ndescription: Review\ndisable-model-invocation: no\n---\nChecklist\n",
      }),
      "invalid-disable-model-invocation",
      "/skills/review/SKILL.md",
    );
  });
});
