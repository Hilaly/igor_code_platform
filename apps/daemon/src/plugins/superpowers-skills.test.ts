import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseSkillFile } from "./file-resource-parser.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const pluginRoot = join(repositoryRoot, "plugins/superpowers");
const skillsRoot = join(pluginRoot, "skills");

const expectedSkills = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;
const coreSkills = [
  "brainstorming",
  "systematic-debugging",
  "test-driven-development",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
] as const;

describe("the built-in Superpowers plugin", () => {
  it("declares the skills-only plugin and the complete upstream inventory", () => {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")) as {
      sovereign?: { id?: string; worker?: string };
    };
    const skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    assert.equal(manifest.sovereign?.id, "superpowers");
    assert.equal(manifest.sovereign?.worker, "src/worker.ts");
    assert.deepEqual(skillDirectories, [...expectedSkills].sort());
  });

  it("parses the planning and quality skills and resolves their relative Markdown links", () => {
    for (const name of coreSkills) {
      const directory = join(skillsRoot, name);
      const entryPath = join(directory, "SKILL.md");
      const text = readFileSync(entryPath, "utf8");
      const parsed = parseSkillFile({ path: entryPath, directoryName: name, text });

      assert.equal(parsed.kind, "valid", name);
      if (parsed.kind === "valid") {
        assert.deepEqual(parsed.diagnostics, [], name);
        assert.match(parsed.definition.description, /^Use when\b/u, name);
      }

      for (const link of markdownLinks(text)) {
        if (link.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(link)) continue;
        const target = resolve(directory, link.split("#", 1)[0] ?? "");
        assert.equal(statSync(target).isFile(), true, `${name} links to missing ${link}`);
      }
    }
  });
});

function markdownLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1]?.trim())
    .filter((link): link is string => link !== undefined && link !== "");
}
