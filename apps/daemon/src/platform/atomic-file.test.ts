import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { writeFileAtomically } from "./atomic-file.ts";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "sovereign-atomic-"));

  directories.push(directory);

  return directory;
}

after(() => {
  for (const directory of directories) {
    // Права возвращаются перед удалением: тест отказа записи снимает их с директории.
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("writeFileAtomically", () => {
  it("writes the text and leaves nothing beside it", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "account.json");

    writeFileAtomically(path, '{"ok":true}\n');

    assert.equal(readFileSync(path, "utf8"), '{"ok":true}\n');
    assert.deepEqual(readdirSync(directory), ["account.json"]);
  });

  it("replaces the previous content whole", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "account.json");

    writeFileAtomically(path, "первый текст подлиннее");
    writeFileAtomically(path, "второй");

    assert.equal(readFileSync(path, "utf8"), "второй");
  });

  it("keeps the file readable by its owner only", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "account.json");

    writeFileAtomically(path, "секрет");

    // Хеш пароля и токены сессий лежат тем же способом: режим — часть механизма, а не пожелание.
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it("does not leave a temporary file behind when the write fails", () => {
    const directory = temporaryDirectory();

    chmodSync(directory, 0o500);

    assert.throws(() => writeFileAtomically(join(directory, "account.json"), "секрет"));

    chmodSync(directory, 0o700);
    assert.deepEqual(readdirSync(directory), []);
  });
});
