import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Session, SessionEntriesPage } from "@sovereign/protocol";

import { createPluginSessions, isSessionRequest } from "./plugin-sessions.ts";
import type { SessionService } from "../sessions/public.ts";

const session: Session = {
  id: "0199",
  projectId: "p1",
  folder: "/tmp/demo",
  agentId: "starter.generic",
  agentAvailable: true,
  model: "scripted/one",
  thinkingLevel: "off",
  phase: "idle",
  archived: false,
  hidden: false,
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
    | "branch"
    | "contextUsage"
    | "compact"
    | "navigate"
    | "labelEntry"
  > = {
    agents: () => [],
    list: (projectId, archived) => {
      calls.push({ list: projectId, archived });

      return [session];
    },
    create: (draft) => {
      calls.push({ create: draft });

      return Promise.resolve({ kind: "created", session });
    },
    entries: () => Promise.resolve(page),
    prompt: () =>
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
    branch: (sessionId, from) => {
      calls.push({ branch: sessionId, from });

      return Promise.resolve({ sessionId, entries: [], leafId: "e-3" });
    },
    contextUsage: (sessionId) =>
      Promise.resolve({ sessionId, tokens: 120, contextWindow: 1000, threshold: 0.8 }),
    compact: (sessionId, request) => {
      calls.push({ compact: sessionId, request });

      return Promise.resolve({
        kind: "accepted",
        accepted: { sessionId, phase: "compaction" },
      });
    },
    navigate: (sessionId, request) => {
      calls.push({ navigate: sessionId, request });

      return Promise.resolve({
        kind: "done",
        navigated: { sessionId, leafId: "e-2", editorText: "второй вопрос", summarized: false },
      });
    },
    labelEntry: (sessionId, entryId, update) => {
      calls.push({ label: sessionId, entryId, update });

      return Promise.resolve({
        kind: "done",
        labelled: {
          sessionId,
          entryId,
          ...(update.label === null ? {} : { label: update.label }),
        },
      });
    },
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

    assert.deepEqual(
      await sessions.answer({ kind: "session-list", projectId: "p1", archived: true }),
      {
        kind: "session-list",
        sessions: [session],
      },
    );
    assert.deepEqual(calls, [{ list: "p1", archived: true }]);
  });

  it("creates a session through the same service the web api uses", async () => {
    const { sessions, calls } = bridge();
    const draft = { projectId: "p1", agentId: "starter.generic" };

    assert.deepEqual(await sessions.answer({ kind: "session-create", draft }), {
      kind: "session-create",
      outcome: { kind: "created", session },
    });
    assert.deepEqual(calls, [{ create: draft }]);
  });

  it("carries a refusal of the subscribers as an outcome, with every author named", async () => {
    const { sessions } = bridge({
      create: () =>
        Promise.resolve({
          kind: "refused-by-hooks",
          refusals: [
            { contributionId: "budget.guard", reason: "бюджет исчерпан" },
            { contributionId: "hours.guard", reason: "не рабочее время" },
          ],
        }),
    });

    // Отказ подписчика — не сбой: он уезжает исходом, а список не сворачивается в первую причину.
    assert.deepEqual(
      await sessions.answer({
        kind: "session-create",
        draft: { projectId: "p1", agentId: "a" },
      }),
      {
        kind: "session-create",
        outcome: {
          kind: "refused",
          refusals: [
            { contributionId: "budget.guard", reason: "бюджет исчерпан" },
            { contributionId: "hours.guard", reason: "не рабочее время" },
          ],
        },
      },
    );
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

  it("gives the plugin the same context surface the routes have", async () => {
    const { sessions, calls } = bridge();

    assert.deepEqual(
      await sessions.answer({ kind: "session-branch", sessionId: "0199", from: "e-1" }),
      { kind: "session-branch", branch: { sessionId: "0199", entries: [], leafId: "e-3" } },
    );
    assert.deepEqual(await sessions.answer({ kind: "session-context", sessionId: "0199" }), {
      kind: "session-context",
      usage: { sessionId: "0199", tokens: 120, contextWindow: 1000, threshold: 0.8 },
    });
    assert.deepEqual(
      await sessions.answer({
        kind: "session-compact",
        sessionId: "0199",
        request: { instructions: "короче" },
      }),
      { kind: "session-compact", accepted: { sessionId: "0199", phase: "compaction" } },
    );
    assert.deepEqual(
      await sessions.answer({
        kind: "session-navigate",
        sessionId: "0199",
        request: { entryId: "e-2" },
      }),
      {
        kind: "session-navigate",
        navigated: {
          sessionId: "0199",
          leafId: "e-2",
          editorText: "второй вопрос",
          summarized: false,
        },
      },
    );
    assert.deepEqual(
      await sessions.answer({
        kind: "session-label",
        sessionId: "0199",
        entryId: "e-2",
        update: { label: null },
      }),
      { kind: "session-label", labelled: { sessionId: "0199", entryId: "e-2" } },
    );

    assert.deepEqual(calls, [
      { branch: "0199", from: "e-1" },
      { compact: "0199", request: { instructions: "короче" } },
      { navigate: "0199", request: { entryId: "e-2" } },
      { label: "0199", entryId: "e-2", update: { label: null } },
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
