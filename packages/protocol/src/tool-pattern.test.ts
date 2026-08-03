import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  matchesToolPattern,
  selectNames,
  selectToolNames,
  type AgentSkillSelection,
  type AgentToolSelection,
  type NamePatternSelection,
} from "./tool-pattern.ts";

describe("matchesToolPattern", () => {
  it("matches a whole name, not a piece of it", () => {
    assert.ok(matchesToolPattern("read", "read"));
    assert.equal(matchesToolPattern("read", "read-file"), false);
    assert.equal(matchesToolPattern("ead", "read"), false);
  });

  it("takes * as any run of characters", () => {
    assert.ok(matchesToolPattern("file-*", "file-read"));
    assert.ok(matchesToolPattern("file-*", "file-"));
    assert.equal(matchesToolPattern("file-*", "read-file"), false);
    assert.ok(matchesToolPattern("*", "anything"));
    assert.ok(matchesToolPattern("*read*", "the-read-tool"));
  });

  it("treats every other metacharacter as an ordinary letter", () => {
    // Шаблонов, а не регулярных выражений: автор плагина пишет `file-*`, а не экранирует точки.
    assert.ok(matchesToolPattern("a.b", "a.b"));
    assert.equal(matchesToolPattern("a.b", "axb"), false);
    assert.equal(matchesToolPattern("re?d", "read"), false);
    assert.ok(matchesToolPattern("re?d", "re?d"));
    assert.ok(matchesToolPattern("a+b[c]", "a+b[c]"));
  });
});

describe("selectToolNames", () => {
  const names = ["bash", "read", "write", "edit", "file-move"];

  it("takes everything the include list asks for", () => {
    assert.deepEqual(selectToolNames(names, { include: ["*"], exclude: [] }), names);
    assert.deepEqual(selectToolNames(names, { include: ["read", "write"], exclude: [] }), [
      "read",
      "write",
    ]);
  });

  it("lets exclude win over include", () => {
    assert.deepEqual(selectToolNames(names, { include: ["*"], exclude: ["bash"] }), [
      "read",
      "write",
      "edit",
      "file-move",
    ]);
    // Пересечение шаблонов решается в пользу исключения, а не по порядку списков.
    assert.deepEqual(selectToolNames(names, { include: ["file-*"], exclude: ["file-move"] }), []);
  });

  it("keeps the order of the tool set, not the order of the patterns", () => {
    // Порядок собранного набора детерминирован (docs/hooks.md), и отбор его не переставляет.
    assert.deepEqual(selectToolNames(names, { include: ["write", "bash"], exclude: [] }), [
      "bash",
      "write",
    ]);
  });

  it("takes an empty include list as nothing, not as everything", () => {
    // «Агент без единого инструмента» — законное состояние (docs/plugins.md), и пустой список
    // значит ровно это: иначе опечатка в наборе молча открыла бы агенту bash.
    assert.deepEqual(selectToolNames(names, { include: [], exclude: [] }), []);
  });
});

describe("selectNames", () => {
  it("shares include and exclude semantics between tools and skills", () => {
    const selection: NamePatternSelection = {
      include: ["github.*", "code-*"],
      exclude: ["*-unsafe"],
    };
    const toolSelection: AgentToolSelection = selection;
    const skillSelection: AgentSkillSelection = selection;

    assert.deepEqual(
      selectNames(["github.review", "code-safe", "code-unsafe", "notes"], selection),
      ["github.review", "code-safe"],
    );
    assert.deepEqual(selectNames(["read"], { include: [], exclude: [] }), []);
    assert.deepEqual(selectNames(["code-safe", "code-unsafe"], toolSelection), ["code-safe"]);
    assert.deepEqual(selectNames(["github.review"], skillSelection), ["github.review"]);
  });
});
