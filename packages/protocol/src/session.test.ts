import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSessionId,
  parseSessionDraft,
  parseTurnRequest,
  sessionEntriesPath,
  sessionPath,
  sessionTurnsPath,
} from "./session.ts";

describe("parseSessionDraft", () => {
  it("reads a project and an agent", () => {
    const result = parseSessionDraft({ projectId: "work", agentId: "base-agent.agent" });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      projectId: "work",
      agentId: "base-agent.agent",
    });
  });

  it("keeps the model and the reasoning level when they are named", () => {
    const result = parseSessionDraft({
      projectId: "work",
      agentId: "base-agent.agent",
      model: "anthropic/claude",
      thinkingLevel: "high",
    });

    assert.deepEqual(result.kind === "parsed" ? result.value.thinkingLevel : undefined, "high");
    assert.deepEqual(result.kind === "parsed" ? result.value.model : undefined, "anthropic/claude");
  });

  it("refuses a draft that names no project or no agent", () => {
    for (const body of [
      {},
      { projectId: "work" },
      { agentId: "a" },
      { projectId: "", agentId: "a" },
    ]) {
      assert.equal(parseSessionDraft(body).kind, "rejected", JSON.stringify(body));
    }
  });

  it("refuses a reasoning level the runtime does not know", () => {
    const result = parseSessionDraft({
      projectId: "work",
      agentId: "a",
      thinkingLevel: "выше крыши",
    });

    assert.equal(result.kind, "rejected");
  });

  it("takes an unknown key as a diagnostic, not a refusal", () => {
    // Понижение версии платформы обязано читать тело, написанное более новой (docs/data-directory.md).
    const result = parseSessionDraft({ projectId: "work", agentId: "a", title: "будущее поле" });

    assert.equal(result.kind, "parsed");
    assert.match(result.diagnostics.join(" "), /title/);
  });
});

describe("parseTurnRequest", () => {
  it("reads the text and the per-turn overrides", () => {
    const result = parseTurnRequest({ text: "сделай", model: "m", thinkingLevel: "off" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      text: "сделай",
      model: "m",
      thinkingLevel: "off",
    });
  });

  it("refuses a turn without text", () => {
    for (const body of [{}, { text: "" }, { text: "   " }, { text: 5 }]) {
      assert.equal(parseTurnRequest(body).kind, "rejected", JSON.stringify(body));
    }
  });
});

describe("isSessionId", () => {
  it("accepts what the runtime creates", () => {
    assert.ok(isSessionId("01998c2f-8a1e-7c3b-9f00-1b2c3d4e5f60"));
    assert.ok(isSessionId("a1b2c3d4"));
  });

  it("refuses anything that could leave the sessions folder", () => {
    // Идентификатор едет в имя файла, поэтому форма проверяется до всякого join.
    for (const value of ["", ".", "..", "a/b", "a\\b", "a b", "../../etc/passwd", 5, null]) {
      assert.equal(isSessionId(value), false, JSON.stringify(value));
    }
  });
});

describe("session paths", () => {
  it("builds the paths of one session", () => {
    assert.equal(sessionPath("abc"), "/api/sessions/abc");
    assert.equal(sessionEntriesPath("abc"), "/api/sessions/abc/entries");
    assert.equal(sessionTurnsPath("abc"), "/api/sessions/abc/turns");
  });
});
