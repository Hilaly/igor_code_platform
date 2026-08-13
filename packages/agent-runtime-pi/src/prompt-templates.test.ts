import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadPromptTemplates, parsePromptTemplateArguments } from "./prompt-templates.ts";

const folders: string[] = [];

after(async () => {
  for (const folder of folders) {
    await rm(folder, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "sovereign-commands-"));

  folders.push(folder);

  return folder;
}

describe("loadPromptTemplates", () => {
  it("reads flat markdown files and takes the name from the file name", async () => {
    const root = await freshRoot();

    await writeFile(
      join(root, "review.md"),
      "---\ndescription: Разбор изменения\n---\n\nРазбери $ARGUMENTS\n",
      "utf8",
    );

    const loaded = await loadPromptTemplates([{ path: root, scope: "user" }]);

    assert.deepEqual(loaded.templates, [
      {
        name: "review",
        description: "Разбор изменения",
        content: "Разбери $ARGUMENTS",
        scope: "user",
      },
    ]);
    assert.deepEqual(loaded.diagnostics, []);
  });

  it("takes the first line for a description when the file has none", async () => {
    const root = await freshRoot();

    await writeFile(join(root, "quick.md"), "Сделай быстро\n", "utf8");

    const loaded = await loadPromptTemplates([{ path: root, scope: "project" }]);

    assert.equal(loaded.templates[0]?.description, "Сделай быстро");
    assert.equal(loaded.templates[0]?.scope, "project");
  });

  it("keeps the templates of every root and says where each came from", async () => {
    const user = await freshRoot();
    const project = await freshRoot();

    await writeFile(join(user, "mine.md"), "мой\n", "utf8");
    await writeFile(join(project, "ours.md"), "наш\n", "utf8");

    const loaded = await loadPromptTemplates([
      { path: user, scope: "user" },
      { path: project, scope: "project" },
    ]);

    assert.deepEqual(
      loaded.templates.map(({ name, scope }) => `${name}:${scope}`),
      ["mine:user", "ours:project"],
    );
  });

  it("does not look into subdirectories and skips what is not markdown", async () => {
    const root = await freshRoot();

    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "nested", "deep.md"), "глубоко\n", "utf8");
    await writeFile(join(root, "notes.txt"), "не шаблон\n", "utf8");
    await writeFile(join(root, "flat.md"), "плоско\n", "utf8");

    const loaded = await loadPromptTemplates([{ path: root, scope: "user" }]);

    assert.deepEqual(
      loaded.templates.map(({ name }) => name),
      ["flat"],
    );
  });

  it("takes a missing root for an empty one: the folder is made when the first template appears", async () => {
    const loaded = await loadPromptTemplates([
      { path: join(await freshRoot(), "nope"), scope: "user" },
    ]);

    assert.deepEqual(loaded.templates, []);
    assert.deepEqual(loaded.diagnostics, []);
  });
});

describe("parsePromptTemplateArguments", () => {
  it("splits the way the substitution reads it, quotes included", () => {
    assert.deepEqual(parsePromptTemplateArguments('срез "пятнадцать b"'), ["срез", "пятнадцать b"]);
    assert.deepEqual(parsePromptTemplateArguments(""), []);
  });
});
