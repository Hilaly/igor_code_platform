import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { ensureDataDirectory, resolveDataDirectory } from "./data-directory.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-data-directory-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

test("a leading tilde expands to the home directory", () => {
  assert.equal(
    resolveDataDirectory("~/.sovereign_platform", "/home/owner"),
    "/home/owner/.sovereign_platform",
  );
  assert.equal(resolveDataDirectory("~", "/home/owner"), "/home/owner");
});

test("a tilde inside the path is not special", () => {
  assert.equal(resolveDataDirectory("/srv/~backup", "/home/owner"), "/srv/~backup");
});

test("a relative path becomes absolute", () => {
  assert.equal(resolveDataDirectory(".sovereign-dev"), join(process.cwd(), ".sovereign-dev"));
});

test("a missing directory is created together with its parents", () => {
  const directory = join(workspace, "nested", "state");

  assert.equal(ensureDataDirectory(directory), directory);
  assert.ok(statSync(directory).isDirectory());
});

test("an existing directory is accepted as is", () => {
  const directory = join(workspace, "existing");

  ensureDataDirectory(directory);

  assert.equal(ensureDataDirectory(directory), directory);
});

test("a path taken by a file is refused with the path in the message", () => {
  const path = join(workspace, "not-a-directory");
  writeFileSync(path, "");

  assert.throws(
    () => ensureDataDirectory(path),
    (error: unknown) => error instanceof Error && error.message.includes(path),
  );
});
