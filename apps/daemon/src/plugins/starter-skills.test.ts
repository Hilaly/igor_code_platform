import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { parseSkillFile } from "./file-resource-parser.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const skillsRoot = join(repositoryRoot, "plugins/starter/skills");
const skillNames = [
  "creating-agents",
  "creating-skills",
  "plugin-backend",
  "plugin-frontend",
] as const;

type SkillArtifact = {
  name: (typeof skillNames)[number];
  directory: string;
  entryPath: string;
  entry: string;
  markdown: Array<{ path: string; text: string }>;
};

const artifacts = skillNames.map(loadSkill);

describe("the built-in starter skills", () => {
  it("parse without diagnostics and advertise concrete triggering conditions", () => {
    for (const artifact of artifacts) {
      const parsed = parseSkillFile({
        path: artifact.entryPath,
        directoryName: artifact.name,
        text: artifact.entry,
      });

      assert.equal(parsed.kind, "valid", artifact.name);
      if (parsed.kind === "valid") {
        assert.deepEqual(parsed.diagnostics, [], artifact.name);
        assert.match(parsed.definition.description, /^Use when\b/u, artifact.name);
      }
    }
  });

  it("use existing bundled references instead of repository-relative documentation", () => {
    for (const artifact of artifacts) {
      const links = markdownLinks(artifact.entry);

      assert.equal(
        links.some((link) => link.startsWith("references/")),
        true,
        `${artifact.name} must link to a bundled reference`,
      );

      for (const link of links) {
        if (link.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(link)) {
          continue;
        }

        const linkPath = link.split("#", 1)[0] ?? "";
        const path = resolve(artifact.directory, linkPath);
        assert.equal(
          artifact.markdown.some((file) => file.path === path),
          true,
          `${artifact.name} links to missing ${link}`,
        );
      }
    }
  });

  it("keep every TypeScript example syntactically valid", () => {
    for (const artifact of artifacts) {
      for (const file of artifact.markdown) {
        for (const fence of typedCodeFences(file.text)) {
          const result = ts.transpileModule(fence.code, {
            compilerOptions: {
              jsx: ts.JsxEmit.ReactJSX,
              module: ts.ModuleKind.NodeNext,
              target: ts.ScriptTarget.ES2023,
            },
            fileName: `example.${fence.language === "tsx" ? "tsx" : "ts"}`,
            reportDiagnostics: true,
          });
          const errors = (result.diagnostics ?? []).filter(
            (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
          );

          assert.deepEqual(
            errors.map((diagnostic) =>
              ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
            ),
            [],
            `${relative(repositoryRoot, file.path)} contains invalid ${fence.language}`,
          );
        }
      }
    }
  });

  it("uses a portable hyphenated name in the canonical skill example", () => {
    const skill = byName("creating-skills");

    assert.doesNotMatch(skill.entry, /^name:\s*[a-z0-9-]*_[a-z0-9_-]*$/gmu);
    assert.match(skill.entry, /^name:\s*code-review$/gmu);
  });

  it("documents every agent parser diagnostic, including invalid-model", () => {
    assert.match(byName("creating-agents").entry, /`invalid-model`/u);
  });

  it("exports browser commands as Command descriptors", () => {
    const frontend = byName("plugin-frontend").entry;

    assert.match(frontend, /export const ClearLogCommand:\s*Command\s*=\s*\{/u);
    assert.match(frontend, /ClearLogCommand:[\s\S]*?\brun\s*:/u);
    assert.doesNotMatch(frontend, /function ClearLogCommand\s*\(/u);
  });

  it("does not publish a newly declared event before activate returns", () => {
    const backend = byName("plugin-backend").entry;

    assert.doesNotMatch(
      backend,
      /await contribute\.event\(taskCreated\);[\s\S]{0,200}?await taskCreated\.publish/u,
    );
  });
});

function loadSkill(name: (typeof skillNames)[number]): SkillArtifact {
  const directory = join(skillsRoot, name);
  const entryPath = join(directory, "SKILL.md");

  return {
    name,
    directory,
    entryPath,
    entry: readFileSync(entryPath, "utf8"),
    markdown: markdownFiles(directory),
  };
}

function markdownFiles(directory: string): Array<{ path: string; text: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return markdownFiles(path);
    }
    if (entry.isFile() && extname(entry.name) === ".md") {
      return [{ path, text: readFileSync(path, "utf8") }];
    }
    return [];
  });
}

function markdownLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1]?.trim())
    .filter((link): link is string => link !== undefined && link !== "");
}

function typedCodeFences(markdown: string): Array<{ language: "ts" | "tsx"; code: string }> {
  return [...markdown.matchAll(/^```(ts|tsx|typescript)\r?\n([\s\S]*?)^```/gmu)].map((match) => ({
    language: match[1] === "tsx" ? "tsx" : "ts",
    code: match[2] ?? "",
  }));
}

function byName(name: (typeof skillNames)[number]): SkillArtifact {
  const artifact = artifacts.find((candidate) => candidate.name === name);
  if (artifact === undefined) {
    throw new Error(`the starter skill ${name} is missing`);
  }
  return artifact;
}
