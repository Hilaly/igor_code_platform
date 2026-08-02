import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { discoverFileResources } from "./file-resource-discovery.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-file-resources-"));
let created = 0;

after(() => rmSync(workspace, { recursive: true, force: true }));

function freshRoot(): string {
  created += 1;
  const root = join(workspace, `root-${created}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeSkill(root: string, name: string, text?: string): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    text ?? `---\nname: ${name}\ndescription: ${name}\n---\nInstructions\n`,
  );
  return directory;
}

describe("discoverFileResources", () => {
  it("discovers one sorted directory level and keeps invalid entries local", () => {
    const root = freshRoot();
    writeSkill(root, "valid");
    writeSkill(root, "broken", "---\nname: [broken\n---\nInstructions\n");
    writeSkill(join(root, "nested", "group"), "ignored");

    const external = freshRoot();
    writeSkill(external, "external");
    symlinkSync(join(external, "external"), join(root, "linked"));

    const discovered = discoverFileResources({ kind: "skill", root });

    assert.deepEqual(
      discovered.map(({ directoryPath }) => directoryPath.split("/").at(-1)),
      ["broken", "linked", "valid"],
    );
    assert.equal(
      discovered.find(({ directoryPath }) => directoryPath.endsWith("/broken"))?.parsed.kind,
      "invalid",
    );
    const linked = discovered.find(({ directoryPath }) => directoryPath.endsWith("/linked"));
    assert.equal(linked?.parsed.kind, "invalid");
    assert.equal(linked?.parsed.diagnostics[0]?.code, "unsupported-symlink");
    assert.equal(linked?.entryPath, join(root, "linked", "SKILL.md"));
    assert.equal(
      discovered.some(({ entryPath }) => entryPath.includes("ignored")),
      false,
    );
  });

  it("rejects a symbolic entry file and continues with later directories", () => {
    const root = freshRoot();
    const external = writeSkill(freshRoot(), "external");
    const linkedEntry = join(root, "linked-entry");
    mkdirSync(linkedEntry);
    symlinkSync(join(external, "SKILL.md"), join(linkedEntry, "SKILL.md"));
    writeSkill(root, "valid");

    const discovered = discoverFileResources({ kind: "skill", root });

    assert.equal(discovered[0]?.parsed.diagnostics[0]?.code, "unsupported-symlink");
    assert.equal(discovered[1]?.parsed.kind, "valid");
  });

  it("accepts an entry of exactly 1 MiB and rejects one byte more before YAML parsing", () => {
    const root = freshRoot();
    const exact = writeSkill(root, "exact");
    const oversized = writeSkill(root, "oversized");
    truncateSync(join(exact, "SKILL.md"), 1_048_576);
    writeFileSync(join(oversized, "SKILL.md"), "---\nname: [oversized\n");
    truncateSync(join(oversized, "SKILL.md"), 1_048_577);

    const discovered = discoverFileResources({ kind: "skill", root });

    assert.equal(discovered[0]?.parsed.kind, "valid");
    assert.equal(discovered[1]?.parsed.diagnostics[0]?.code, "entry-too-large");
  });

  it("does not inspect or quota-scan sibling resources", () => {
    const root = freshRoot();
    const directory = writeSkill(root, "valid");
    writeFileSync(join(directory, "large-resource.bin"), "");
    truncateSync(join(directory, "large-resource.bin"), 1_048_577);
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "nested", "SKILL.md"), "broken: [");
    symlinkSync(join(freshRoot(), "outside"), join(directory, "linked-resource"));

    const discovered = discoverFileResources({ kind: "skill", root });

    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]?.parsed.kind, "valid");
  });

  it("treats a missing root as empty", () => {
    assert.deepEqual(
      discoverFileResources({ kind: "agent", root: join(workspace, "never-created") }),
      [],
    );
  });
});
