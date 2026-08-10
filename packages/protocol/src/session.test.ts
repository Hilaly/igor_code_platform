import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSessionId,
  parseSessionDraft,
  parseSessionForkRequest,
  parseSessionMessage,
  parseSessionUpdate,
  parseTurnRequest,
  sessionEntriesPath,
  sessionForkPath,
  sessionMessagesPath,
  sessionPath,
  sessionStatsPath,
  sessionTurnsPath,
  type AgentSummary,
  type Session,
} from "./session.ts";

describe("AgentSummary", () => {
  it("keeps normalized skills and distinguishes plugin from standalone ownership", () => {
    const pluginAgent: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      pluginKey: "builtin:github",
      source: "builtin",
      skills: { include: ["github.*"], exclude: ["*-unsafe"] },
    };
    const standaloneAgent: AgentSummary = {
      id: "review",
      ownership: "standalone",
      source: "native:user-agents",
      scope: "user",
      skills: { include: [], exclude: [] },
    };

    assert.equal(
      pluginAgent.ownership === "plugin" ? pluginAgent.pluginKey : undefined,
      "builtin:github",
    );
    assert.equal(
      standaloneAgent.ownership === "standalone" ? standaloneAgent.scope : undefined,
      "user",
    );

    // @ts-expect-error — plugin-owned summaries always identify their plugin instance.
    const pluginWithoutKey: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      source: "builtin",
      skills: { include: [], exclude: [] },
    };
    // @ts-expect-error — standalone summaries do not fabricate a plugin owner.
    const standaloneWithKey: AgentSummary = {
      id: "review",
      ownership: "standalone",
      pluginKey: "builtin:fake",
      source: "native:user-agents",
      scope: "user",
      skills: { include: [], exclude: [] },
    };
    const skillsWithoutExclude: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      pluginKey: "builtin:github",
      source: "builtin",
      // @ts-expect-error — summaries carry normalized selectors, including an explicit exclude list.
      skills: { include: ["github.*"] },
    };

    assert.ok(pluginWithoutKey);
    assert.ok(standaloneWithKey);
    assert.ok(skillsWithoutExclude);
  });
});

describe("Session", () => {
  it("reports whether its current project agent is available", () => {
    const session: Session = {
      id: "0199",
      projectId: "p1",
      folder: "/tmp/demo",
      agentId: "starter.generic",
      agentAvailable: false,
      model: "scripted/one",
      thinkingLevel: "off",
      phase: "idle",
      archived: false,
      createdAt: "2026-08-02T09:00:00.000Z",
    };

    assert.equal(session.agentAvailable, false);
  });
});

describe("parseSessionDraft", () => {
  it("reads a project and an agent", () => {
    const result = parseSessionDraft({ projectId: "work", agentId: "starter.generic" });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      projectId: "work",
      agentId: "starter.generic",
    });
  });

  it("keeps the model and the reasoning level when they are named", () => {
    const result = parseSessionDraft({
      projectId: "work",
      agentId: "starter.generic",
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

describe("parseSessionUpdate", () => {
  it("reads a rename together with the archive flag", () => {
    const result = parseSessionUpdate({ title: "  разбор бага  ", archived: false });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      title: "разбор бага",
      archived: false,
    });
  });

  it("takes a body without a title as a session with no name", () => {
    const result = parseSessionUpdate({ archived: true });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, { archived: true });
  });

  it("refuses a body without the archive flag", () => {
    // Тело заменяет запись целиком: молчаливое умолчание разархивировало бы сессию при переименовании.
    assert.equal(parseSessionUpdate({ title: "имя" }).kind, "rejected");
    assert.equal(parseSessionUpdate({ title: "имя", archived: "да" }).kind, "rejected");
  });

  it("refuses a title made of spaces instead of silently clearing it", () => {
    assert.equal(parseSessionUpdate({ title: "   ", archived: false }).kind, "rejected");
  });
});

describe("parseSessionForkRequest", () => {
  it("takes an empty body as a fork of the whole session", () => {
    for (const body of [{}, undefined, null]) {
      const result = parseSessionForkRequest(body);

      assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {}, String(body));
    }
  });

  it("reads the entry to cut at and where to cut", () => {
    const result = parseSessionForkRequest({ entryId: "e7", position: "at" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      entryId: "e7",
      position: "at",
    });
  });

  it("refuses a position with nothing to cut at", () => {
    assert.equal(parseSessionForkRequest({ position: "before" }).kind, "rejected");
  });

  it("refuses a position the runtime does not know", () => {
    assert.equal(parseSessionForkRequest({ entryId: "e7", position: "after" }).kind, "rejected");
  });
});

describe("parseSessionMessage", () => {
  it("reads the text and the mode", () => {
    const result = parseSessionMessage({ text: "  левее  ", mode: "steer" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      text: "левее",
      mode: "steer",
    });
  });

  it("refuses a message without a mode", () => {
    // Умолчания нет намеренно: у четырёх режимов разные предусловия по занятости сессии.
    assert.equal(parseSessionMessage({ text: "левее" }).kind, "rejected");
    assert.equal(parseSessionMessage({ text: "левее", mode: "steering" }).kind, "rejected");
  });

  it("refuses a message without text", () => {
    for (const body of [{ mode: "steer" }, { text: "  ", mode: "steer" }]) {
      assert.equal(parseSessionMessage(body).kind, "rejected", JSON.stringify(body));
    }
  });
});

describe("session paths", () => {
  it("builds the paths of one session", () => {
    assert.equal(sessionPath("abc"), "/api/sessions/abc");
    assert.equal(sessionEntriesPath("abc"), "/api/sessions/abc/entries");
    assert.equal(sessionTurnsPath("abc"), "/api/sessions/abc/turns");
    assert.equal(sessionForkPath("abc"), "/api/sessions/abc/fork");
    assert.equal(sessionMessagesPath("abc"), "/api/sessions/abc/messages");
    assert.equal(sessionStatsPath("abc"), "/api/sessions/abc/stats");
  });
});
