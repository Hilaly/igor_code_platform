import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Session, SessionEntriesPage } from "@sovereign/protocol";

import { createPluginSessions, isSessionRequest } from "./plugin-sessions.ts";
import type { CreateSessionOutcome, PromptOutcome, SessionService } from "./sessions.ts";

const session: Session = {
  id: "0199",
  projectId: "p1",
  folder: "/tmp/demo",
  agentId: "base-agent.agent",
  model: "scripted/one",
  thinkingLevel: "off",
  phase: "idle",
  archived: false,
  createdAt: "2026-07-29T09:00:00.000Z",
};

const page: SessionEntriesPage = { sessionId: "0199", entries: [], seen: 0 };

const counters = {
  messageCount: 2,
  cachedTokens: 0,
  uncachedTokens: 7,
  totalTokens: 7,
  costTotal: 0.01,
};

function bridge(overrides: Partial<SessionService> = {}) {
  const calls: unknown[] = [];
  const service: Pick<
    SessionService,
    | "agents"
    | "list"
    | "create"
    | "entries"
    | "prompt"
    | "abort"
    | "fork"
    | "update"
    | "remove"
    | "message"
    | "stats"
  > = {
    agents: () => [],
    list: (projectId) => {
      calls.push({ list: projectId });

      return [session];
    },
    create: (draft): Promise<CreateSessionOutcome> => {
      calls.push({ create: draft });

      return Promise.resolve({ kind: "created", session });
    },
    entries: () => Promise.resolve(page),
    prompt: (): Promise<PromptOutcome> =>
      Promise.resolve({
        kind: "accepted",
        turn: { sessionId: "0199", turnId: "t1", phase: "turn" },
      }),
    abort: () => Promise.resolve(true),
    fork: (sessionId, request) => {
      calls.push({ fork: sessionId, request });

      return Promise.resolve({ kind: "done", session });
    },
    update: (sessionId, update) => {
      calls.push({ update: sessionId, wanted: update });

      return Promise.resolve({ kind: "done", session });
    },
    remove: (sessionId) => {
      calls.push({ remove: sessionId });

      return Promise.resolve({ kind: "removed" });
    },
    message: (sessionId, message) => {
      calls.push({ message: sessionId, wanted: message });

      return Promise.resolve({ kind: "accepted", accepted: { sessionId, mode: message.mode } });
    },
    stats: (sessionId) => Promise.resolve({ sessionId, ...counters }),
    ...overrides,
  };

  return { calls, sessions: createPluginSessions({ sessions: service }) };
}

describe("isSessionRequest", () => {
  it("tells the two channels of the plugin apart", () => {
    assert.equal(isSessionRequest({ kind: "session-list" }), true);
    assert.equal(isSessionRequest({ kind: "agent-list" }), true);
    assert.equal(isSessionRequest({ kind: "list" }), false);
    assert.equal(isSessionRequest({ kind: "models", providerId: "anthropic" }), false);
  });
});

describe("createPluginSessions", () => {
  it("hands the list over as the service gave it", async () => {
    const { sessions, calls } = bridge();

    assert.deepEqual(await sessions.answer({ kind: "session-list", projectId: "p1" }), {
      kind: "session-list",
      sessions: [session],
    });
    assert.deepEqual(calls, [{ list: "p1" }]);
  });

  it("creates a session through the same service the web api uses", async () => {
    const { sessions, calls } = bridge();
    const draft = { projectId: "p1", agentId: "base-agent.agent" };

    assert.deepEqual(await sessions.answer({ kind: "session-create", draft }), {
      kind: "session-create",
      session,
    });
    assert.deepEqual(calls, [{ create: draft }]);
  });

  it("turns a domain refusal into a failure with the reason, not into an exception", async () => {
    const { sessions } = bridge({
      create: () => Promise.resolve({ kind: "refused", reason: "the project is archived" }),
    });

    assert.deepEqual(
      await sessions.answer({
        kind: "session-create",
        draft: { projectId: "p1", agentId: "a" },
      }),
      { kind: "failed", reason: "the project is archived" },
    );
  });

  it("names the project when there is none", async () => {
    const { sessions } = bridge({ create: () => Promise.resolve({ kind: "unknown-project" }) });

    const answer = await sessions.answer({
      kind: "session-create",
      draft: { projectId: "выдуманный", agentId: "a" },
    });

    assert.equal(answer.kind, "failed");
    assert.match(answer.kind === "failed" ? answer.reason : "", /выдуманный/);
  });

  it("answers about a session nobody created instead of pretending it is empty", async () => {
    const { sessions } = bridge({ entries: () => Promise.resolve(undefined) });

    const answer = await sessions.answer({ kind: "session-entries", sessionId: "невидимка" });

    assert.equal(answer.kind, "failed");
    assert.match(answer.kind === "failed" ? answer.reason : "", /невидимка/);
  });

  it("carries the interruption outcome as it is: nothing to interrupt is not a failure", async () => {
    const { sessions } = bridge({ abort: () => Promise.resolve(false) });

    assert.deepEqual(await sessions.answer({ kind: "session-abort", sessionId: "0199" }), {
      kind: "session-abort",
      interrupted: false,
    });
  });
});

describe("the lifecycle over the plugin bridge", () => {
  it("calls the very same service functions the routes call", async () => {
    const { sessions, calls } = bridge();

    assert.deepEqual(
      await sessions.answer({ kind: "session-fork", sessionId: "0199", request: {} }),
      {
        kind: "session-fork",
        session,
      },
    );
    assert.deepEqual(
      await sessions.answer({
        kind: "session-update",
        sessionId: "0199",
        update: { title: "имя", archived: false },
      }),
      { kind: "session-update", session },
    );
    assert.deepEqual(await sessions.answer({ kind: "session-remove", sessionId: "0199" }), {
      kind: "session-remove",
    });
    assert.deepEqual(
      await sessions.answer({
        kind: "session-message",
        sessionId: "0199",
        message: { text: "левее", mode: "steer" },
      }),
      { kind: "session-message", accepted: { sessionId: "0199", mode: "steer" } },
    );
    assert.deepEqual(await sessions.answer({ kind: "session-stats", sessionId: "0199" }), {
      kind: "session-stats",
      stats: { sessionId: "0199", ...counters },
    });

    assert.deepEqual(calls, [
      { fork: "0199", request: {} },
      { update: "0199", wanted: { title: "имя", archived: false } },
      { remove: "0199" },
      { message: "0199", wanted: { text: "левее", mode: "steer" } },
    ]);
  });

  it("turns a refusal into a failure with the reason, and a miss into a named session", async () => {
    const busy = bridge({
      update: () => Promise.resolve({ kind: "refused", reason: "the session is busy" }),
      remove: () => Promise.resolve({ kind: "unknown" }),
    });

    assert.deepEqual(
      await busy.sessions.answer({
        kind: "session-update",
        sessionId: "0199",
        update: { archived: true },
      }),
      { kind: "failed", reason: "the session is busy" },
    );

    const missing = await busy.sessions.answer({ kind: "session-remove", sessionId: "невидимка" });

    assert.equal(missing.kind, "failed");
    assert.match(missing.kind === "failed" ? missing.reason : "", /невидимка/);
  });
});
