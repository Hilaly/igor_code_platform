import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { searchProjectFiles } from "./project-files.ts";

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Папка проекта с перечисленными файлами; каталоги создаются по пути сами. */
function project(paths: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "sovereign-project-files-"));

  roots.push(root);

  for (const path of paths) {
    const full = join(root, path);

    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "");
  }

  return root;
}

describe("searchProjectFiles", () => {
  it("lists relative paths with forward slashes and no query at all", () => {
    const folder = project(["README.md", join("src", "main.ts")]);

    assert.deepEqual(searchProjectFiles({ folder, query: "" }).paths, ["README.md", "src/main.ts"]);
  });

  it("puts a hit in the file name before a hit in the folder", () => {
    // Набирая `@readme`, человек ищет файл, а не всё, что лежит в папке с таким именем.
    const folder = project([join("readme", "notes.txt"), "readme.md"]);

    assert.deepEqual(searchProjectFiles({ folder, query: "readme" }).paths, [
      "readme.md",
      "readme/notes.txt",
    ]);
  });

  it("matches case-insensitively, in the name and in the folder", () => {
    const folder = project([join("Docs", "Guide.md"), "other.txt"]);

    assert.deepEqual(searchProjectFiles({ folder, query: "GUIDE" }).paths, ["Docs/Guide.md"]);
    assert.deepEqual(searchProjectFiles({ folder, query: "docs/" }).paths, ["Docs/Guide.md"]);
    assert.deepEqual(searchProjectFiles({ folder, query: "ничего" }).paths, []);
  });

  it("walks past nothing that holds somebody else's files or build output", () => {
    const folder = project([
      "keep.ts",
      join("node_modules", "left", "index.js"),
      join(".git", "config"),
      join("dist", "bundle.js"),
      join("src", "__pycache__", "cached.pyc"),
    ]);

    assert.deepEqual(searchProjectFiles({ folder, query: "" }).paths, ["keep.ts"]);
  });

  it("says the list was cut instead of quietly showing a part of it", () => {
    const folder = project(["a.ts", "b.ts", "c.ts"]);
    const cut = searchProjectFiles({ folder, query: "", limit: 2 });

    assert.equal(cut.paths.length, 2);
    assert.equal(cut.truncated, true);
    assert.equal(searchProjectFiles({ folder, query: "" }).truncated, false);
  });

  it("stops at the depth limit instead of following a link back to the parent", () => {
    const folder = project([join("deep", "one", "two", "three", "buried.ts"), "top.ts"]);

    symlinkSync(folder, join(folder, "loop"), "dir");

    const shallow = searchProjectFiles({ folder, query: "", maxDepth: 1 });

    assert.deepEqual(shallow.paths, ["top.ts"]);

    // Симлинк на родителя не разворачивается: обход завершается, и путей вида `loop/...` не бывает.
    const whole = searchProjectFiles({ folder, query: "" });

    assert.deepEqual(whole.paths.sort(), ["deep/one/two/three/buried.ts", "top.ts"]);
  });

  it("gives up on a folder it cannot read instead of failing the whole search", () => {
    const folder = project(["visible.ts"]);

    assert.deepEqual(searchProjectFiles({ folder: join(folder, "нет-такой-папки"), query: "" }), {
      paths: [],
      truncated: false,
    });
  });
});
