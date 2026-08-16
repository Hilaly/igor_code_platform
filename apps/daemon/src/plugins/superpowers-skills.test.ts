import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseSkillFile } from "./file-resource-parser.ts";
import { discoverPlugins } from "./plugin-sources.ts";

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

  it("parses every skill and resolves Markdown links in every bundled resource", () => {
    for (const name of expectedSkills) {
      const directory = join(skillsRoot, name);
      const entryPath = join(directory, "SKILL.md");
      const text = readFileSync(entryPath, "utf8");
      const parsed = parseSkillFile({ path: entryPath, directoryName: name, text });

      assert.equal(parsed.kind, "valid", name);
      if (parsed.kind === "valid") {
        assert.deepEqual(parsed.diagnostics, [], name);
        assert.match(parsed.definition.description, /^Use when\b/u, name);
      }
    }

    for (const path of walkFiles(skillsRoot).filter(
      (candidate) =>
        candidate.endsWith(".md") &&
        !candidate.includes("/examples/") &&
        !candidate.endsWith("/anthropic-best-practices.md"),
    )) {
      const text = readFileSync(path, "utf8");
      for (const link of markdownLinks(text)) {
        if (link.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(link)) continue;
        const target = resolve(dirname(path), link.split("#", 1)[0] ?? "");
        assert.equal(statSync(target).isFile(), true, `${path} links to missing ${link}`);
      }
    }
  });

  it("keeps live script invocations executable without relying on file mode", () => {
    const liveInstructions = walkFiles(skillsRoot)
      .filter((path) => path.endsWith(".md") && !path.includes("/examples/"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(liveInstructions, /^\s*(?:\.\/)?[^\s`]+\.(?:sh|js)\s/mu);
    assert.match(liveInstructions, /bash scripts\/start-server\.sh/u);
    assert.match(liveInstructions, /node render-graphs\.cjs/u);
  });

  it("discovers exactly 14 qualified skills without invalid resources", () => {
    const discovery = discoverPlugins([
      { source: "builtin", directory: join(repositoryRoot, "plugins") },
    ]);
    const plugin = discovery.plugins.find((candidate) => candidate.key === "builtin:superpowers");

    assert.ok(plugin, "builtin:superpowers must be discovered");
    assert.deepEqual(plugin.fileResources.invalid, []);
    assert.deepEqual(
      plugin.fileResources.definitions
        .map((definition) => `${plugin.id}.${definition.name}`)
        .sort(),
      expectedSkills.map((name) => `superpowers.${name}`).sort(),
    );
  });

  it("ships required neighboring resources and no symbolic links", () => {
    const relativeFiles = [
      join(pluginRoot, "LICENSE"),
      join(pluginRoot, "UPSTREAM-ADAPTATION.md"),
      ...walkFiles(skillsRoot),
    ].map((path) => relative(pluginRoot, path));
    for (const required of [
      "LICENSE",
      "UPSTREAM-ADAPTATION.md",
      "skills/brainstorming/visual-companion.md",
      "skills/brainstorming/scripts/server.cjs",
      "skills/requesting-code-review/code-reviewer.md",
      "skills/subagent-driven-development/implementer-prompt.md",
      "skills/subagent-driven-development/scripts/review-package",
      "skills/systematic-debugging/root-cause-tracing.md",
      "skills/test-driven-development/writing-good-tests.md",
      "skills/using-superpowers/references/sovereign-tools.md",
      "skills/writing-plans/plan-document-reviewer-prompt.md",
      "skills/writing-skills/testing-skills-with-subagents.md",
    ]) {
      assert.ok(relativeFiles.includes(required), required);
    }
  });

  it("does not instruct agents to call unsupported runtime tools", () => {
    const liveInstructions = walkFiles(skillsRoot)
      .filter((path) => !path.endsWith("CREATION-LOG.md") && !path.includes("/examples/"))
      .filter((path) => /\.(?:md|yaml|sh|js|cjs)$/u.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(
      liveInstructions,
      /\b(?:TodoWrite|update_plan|TaskCreate|TaskUpdate|TaskList|AskUserQuestion|invoke_agent|invoke_subagent|EnterWorktree|WorktreeCreate)\b/u,
    );
    assert.doesNotMatch(liveInstructions, /Subagent \(general-purpose\)/u);
    assert.doesNotMatch(liveInstructions, /superpowers:[a-z0-9-]+/u);
    assert.match(liveInstructions, /\bmission-update\b/u);
    assert.match(liveInstructions, /\bsubagent-spawn\b/u);
  });

  it("keeps Sovereign live guidance free of known pressure regressions", () => {
    const liveInstructions = walkFiles(skillsRoot)
      .filter((path) => !path.endsWith("CREATION-LOG.md") && !path.includes("/examples/"))
      .filter((path) => /\.(?:md|yaml|sh|js|cjs)$/u.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(liveInstructions, /git rev-parse HEAD~1/u);
    assert.doesNotMatch(liveInstructions, /subagent-spawn:\s*["']/u);
    assert.doesNotMatch(liveInstructions, /`npm test`/u);
    assert.doesNotMatch(liveInstructions, /skills\/debugging\/systematic-debugging/u);
    assert.doesNotMatch(liveInstructions, /~\/\.claude/u);
    assert.match(liveInstructions, /push only when the user explicitly authorizes/u);
    assert.match(liveInstructions, /BRANCH_NAME/iu);
  });
});

function markdownLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1]?.trim())
    .filter((link): link is string => link !== undefined && link !== "");
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    assert.equal(lstatSync(path).isSymbolicLink(), false, `${path} must not be a symbolic link`);
    return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
  });
}
