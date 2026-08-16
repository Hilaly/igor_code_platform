import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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
});
