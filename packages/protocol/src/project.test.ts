import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseProjectDraft,
  parseProjectUpdate,
  projectPath,
  projectPathPattern,
  projectsPath,
} from "./project.ts";

describe("projectPath", () => {
  it("follows the pattern the daemon route table declares", () => {
    assert.equal(projectPathPattern, `${projectsPath}/:id`);
    assert.equal(projectPath("b7Kq3xv9pQdT"), "/api/projects/b7Kq3xv9pQdT");
  });

  it("encodes an identifier so it cannot open a second path segment", () => {
    assert.equal(projectPath("a/b"), "/api/projects/a%2Fb");
  });
});

describe("parseProjectDraft", () => {
  it("takes a folder and a name", () => {
    const result = parseProjectDraft({ folder: "~/code/platform", name: "Платформа" });

    assert.ok(result.kind === "parsed");
    assert.deepEqual(result.value, { folder: "~/code/platform", name: "Платформа" });
    assert.deepEqual(result.diagnostics, []);
  });

  it("trims both: a trailing space is a typo, not part of the path", () => {
    const result = parseProjectDraft({ folder: "  /code/platform  ", name: "  Платформа " });

    assert.ok(result.kind === "parsed");
    assert.deepEqual(result.value, { folder: "/code/platform", name: "Платформа" });
  });

  it("refuses a body that is not an object", () => {
    for (const raw of [undefined, null, "text", 1, ["/code"]]) {
      assert.equal(
        parseProjectDraft(raw).kind,
        "rejected",
        `${JSON.stringify(raw)} must be refused`,
      );
    }
  });

  it("refuses a missing or blank folder: the folder cannot be changed later", () => {
    for (const folder of [undefined, "", "   ", 1, null]) {
      const result = parseProjectDraft({ folder, name: "Проект" });

      assert.equal(result.kind, "rejected", `folder ${JSON.stringify(folder)} must be refused`);
      assert.ok(result.diagnostics.some((line) => line.includes("folder")));
    }
  });

  it("refuses a missing or blank name", () => {
    for (const name of [undefined, "", "   ", 1, null]) {
      const result = parseProjectDraft({ folder: "/code", name });

      assert.equal(result.kind, "rejected", `name ${JSON.stringify(name)} must be refused`);
      assert.ok(result.diagnostics.some((line) => line.includes("name")));
    }
  });

  it("ignores an unknown key with a diagnostic instead of refusing", () => {
    // Тело, написанное более новой платформой, обязано читаться старой: иначе понижение версии
    // перестаёт принимать запросы своего же интерфейса.
    const result = parseProjectDraft({ folder: "/code", name: "Проект", colour: "red" });

    assert.ok(result.kind === "parsed");
    assert.ok(result.diagnostics.some((line) => line.includes("colour")));
  });

  it("does not take fields the platform owns", () => {
    const result = parseProjectDraft({
      folder: "/code",
      name: "Проект",
      id: "smuggled",
      archived: true,
      availability: "available",
    });

    assert.ok(result.kind === "parsed");
    assert.deepEqual(result.value, { folder: "/code", name: "Проект" });
    assert.equal(result.diagnostics.length, 3);
  });
});

describe("parseProjectUpdate", () => {
  it("takes the whole record: renaming and archiving go through one write", () => {
    const result = parseProjectUpdate({ name: "Другое имя", archived: true });

    assert.ok(result.kind === "parsed");
    assert.deepEqual(result.value, { name: "Другое имя", archived: true });
  });

  it("requires both fields: the write replaces the record", () => {
    // Тело без `archived` разархивировало бы проект человеку, который менял только имя.
    assert.equal(parseProjectUpdate({ name: "Имя" }).kind, "rejected");
    assert.equal(parseProjectUpdate({ archived: false }).kind, "rejected");
  });

  it("refuses a blank name and a non-boolean archived", () => {
    assert.equal(parseProjectUpdate({ name: "  ", archived: false }).kind, "rejected");
    assert.equal(parseProjectUpdate({ name: "Имя", archived: "yes" }).kind, "rejected");
  });

  it("does not take the folder: it is fixed at creation", () => {
    const result = parseProjectUpdate({ name: "Имя", archived: false, folder: "/elsewhere" });

    assert.ok(result.kind === "parsed");
    assert.deepEqual(result.value, { name: "Имя", archived: false });
    assert.ok(result.diagnostics.some((line) => line.includes("folder")));
  });
});
