import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  ensureDataDirectory,
  pluginsDirectoryName,
  resolveDataDirectory,
  workDirectoryName,
} from "./data-directory.ts";

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

test("the plugin root and the ephemeral project folder are created too", () => {
  // Эфемерный проект есть всегда (docs/sessions-and-projects.md), а без папки на диске «есть
  // всегда» означало бы «первая же сессия в нём падает».
  const directory = join(workspace, "with-folders");

  ensureDataDirectory(directory);

  assert.ok(statSync(join(directory, pluginsDirectoryName)).isDirectory());
  assert.ok(statSync(join(directory, workDirectoryName)).isDirectory());
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
