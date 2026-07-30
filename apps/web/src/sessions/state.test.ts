import { coreEventTypes, type Session, type SessionEntry } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyEntries,
  applyPendingTurn,
  applySessionDelta,
  applySessions,
  applyStreamEvent,
  applySummary,
  closeSession,
  initialSessionsState,
  isBusy,
  openSession,
  reconnected,
  type SessionsState,
} from "./state.ts";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "0199",
  projectId: "b7Kq",
  folder: "/code/platform",
  agentId: "base-agent.agent",
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  phase: "idle",
  createdAt: "2026-07-29T00:00:00.000Z",
  ...overrides,
});

const entry = (id: string): SessionEntry => ({
  id,
  time: "2026-07-29T00:00:00.000Z",
  kind: "message",
  role: "agent",
  content: [{ kind: "text", text: id }],
});

const opened = (state: SessionsState = initialSessionsState): SessionsState =>
  openSession(applySessions(state, { sessions: [session()] }), "0199");

describe("the list of sessions", () => {
  it("tells an empty snapshot from no snapshot at all", () => {
    // Пустой список — «сессий нет», отсутствие снимка — «ещё не спросили»; показывать надо разное.
    expect(initialSessionsState.sessions).toBeUndefined();
    expect(applySessions(initialSessionsState, { sessions: [] }).sessions).toEqual([]);
  });

  it("keeps the sessions whose file could not be read as a problem of their own", () => {
    const state = applySessions(initialSessionsState, {
      sessions: [],
      problems: ["0199: not valid json"],
    });

    expect(state.problems).toEqual(["0199: not valid json"]);
  });

  it("leaves the open session alone: absent from the list is not absent at all", () => {
    // Сессия архивного проекта из списка пропадает, но по своему адресу читается по-прежнему.
    const state = applySessions(opened(), { sessions: [] });

    expect(state.open?.summary?.id).toBe("0199");
  });
});

describe("the snapshot of the open session", () => {
  it("carries the phase, and the phase is what the view believes", () => {
    const state = applySummary(opened(), "0199", session({ phase: "turn" }));

    expect(state.open?.summary?.phase).toBe("turn");
  });

  it("takes a session that is gone for an answer, and stops waiting", () => {
    const state = applySummary(opened(), "0199", undefined);

    expect(state.open?.summary).toBeUndefined();
    expect(state.open?.loading).toBe(false);
  });

  it("ignores an answer about a session nobody is looking at", () => {
    const state = opened();

    expect(applySummary(state, "0200", session({ id: "0200" }))).toBe(state);
  });
});

describe("opening and closing", () => {
  it("throws away everything left from the previous session", () => {
    const withEntries = applyEntries(opened(), "0199", [entry("a")], 1);
    const other = openSession(withEntries, "0200");

    expect(other.open?.id).toBe("0200");
    expect(other.open?.entries).toEqual([]);
    expect(other.open?.seen).toBe(0);
  });

  it("does not restart the session that is already open", () => {
    const withEntries = applyEntries(opened(), "0199", [entry("a")], 1);

    expect(openSession(withEntries, "0199")).toBe(withEntries);
  });

  it("closes into no open session at all", () => {
    expect(closeSession(opened()).open).toBeUndefined();
  });
});

describe("entries", () => {
  it("appends a page and keeps the cursor the daemon gave, not the length of the list", () => {
    // Одна запись рантайма даёт больше одной нашей: длина списка курсору не равна.
    const state = applyEntries(opened(), "0199", [entry("a"), entry("b")], 5);

    expect(state.open?.entries.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(state.open?.seen).toBe(5);
    expect(state.open?.loading).toBe(false);
  });

  it("ignores a page that belongs to a session nobody is looking at", () => {
    const state = opened();

    expect(applyEntries(state, "0200", [entry("a")], 1)).toBe(state);
  });
});

describe("deltas of a turn", () => {
  const deltas = (state: SessionsState, kinds: Parameters<typeof applySessionDelta>[3][]) =>
    kinds.reduce(
      (current, delta) => applySessionDelta(current, "0199", "turn-1", delta).state,
      state,
    );

  it("ignores a frame that belongs to another session", () => {
    // Кадры рассылаются всем клиентам без фильтра: корреляция по идентификатору — наша.
    const state = opened();
    const outcome = applySessionDelta(state, "0200", "turn-1", { kind: "turn-end" });

    expect(outcome.state).toBe(state);
    expect(outcome.reread).toBe(false);
  });

  it("keeps the two channels of one message apart", () => {
    const state = deltas(opened(), [
      { kind: "message-start", messageId: "turn-1:1", role: "agent" },
      { kind: "message-delta", messageId: "turn-1:1", channel: "reasoning", text: "думаю" },
      { kind: "message-delta", messageId: "turn-1:1", channel: "text", text: "при" },
      { kind: "message-delta", messageId: "turn-1:1", channel: "text", text: "вет" },
    ]);

    const message = state.open?.live?.items["turn-1:1"];
    expect(message).toMatchObject({ kind: "message", text: "привет", reasoning: "думаю" });
  });

  it("takes a delta without a start for a message all the same", () => {
    // Подключиться можно посреди сообщения: терять его текст из-за пропущенного начала нельзя.
    const state = deltas(opened(), [
      { kind: "message-delta", messageId: "turn-1:1", channel: "text", text: "вет" },
    ]);

    expect(state.open?.live?.items["turn-1:1"]).toMatchObject({ text: "вет", role: "agent" });
  });

  it("keeps the order in which the model alternated text and tool calls", () => {
    const state = deltas(opened(), [
      { kind: "message-start", messageId: "turn-1:1", role: "agent" },
      { kind: "tool-start", toolCallId: "call-1", toolName: "write_file", input: { path: "a" } },
      { kind: "message-start", messageId: "turn-1:2", role: "agent" },
    ]);

    expect(state.open?.live?.order).toEqual(["turn-1:1", "call-1", "turn-1:2"]);
  });

  it("marks a tool call finished with the outcome the daemon sent", () => {
    const state = deltas(opened(), [
      { kind: "tool-start", toolCallId: "call-1", toolName: "write_file", input: {} },
      { kind: "tool-end", toolCallId: "call-1", failed: true },
    ]);

    expect(state.open?.live?.items["call-1"]).toMatchObject({ done: true, failed: true });
  });

  it("throws the whole buffer away at the end of a turn and asks for the entries", () => {
    // Идентификатор сообщения синтетический: записи с ним не существует, и склеить их нечем.
    const running = deltas(opened(), [
      { kind: "message-start", messageId: "turn-1:1", role: "agent" },
      { kind: "message-delta", messageId: "turn-1:1", channel: "text", text: "привет" },
    ]);
    const outcome = applySessionDelta(running, "0199", "turn-1", { kind: "turn-end" });

    expect(outcome.state.open?.live).toBeUndefined();
    expect(outcome.reread).toBe(true);
  });

  it("keeps the reason of a failed turn where the view can show it", () => {
    const outcome = applySessionDelta(opened(), "0199", "turn-1", {
      kind: "turn-failed",
      reason: "the model refused",
    });

    expect(outcome.state.open?.failure).toBe("the model refused");
    expect(outcome.reread).toBe(true);
  });

  it("starts a new buffer when the next turn begins", () => {
    const first = deltas(opened(), [
      { kind: "message-start", messageId: "turn-1:1", role: "agent" },
    ]);
    const second = applySessionDelta(first, "0199", "turn-2", {
      kind: "message-start",
      messageId: "turn-2:1",
      role: "agent",
    }).state;

    expect(second.open?.live?.turnId).toBe("turn-2");
    expect(second.open?.live?.order).toEqual(["turn-2:1"]);
  });

  it("believes the phase a delta carries: it arrives before the snapshot does", () => {
    const state = deltas(opened(), [{ kind: "phase", phase: "turn" }]);

    expect(state.open?.summary?.phase).toBe("turn");
  });
});

describe("a turn that was only submitted", () => {
  it("shows the text of the human before the queue got to it", () => {
    // Турн в очереди не даёт ни одной дельты: без этого реплика ждала бы конца чужого турна.
    const state = applyPendingTurn(opened(), "0199", "turn-1", "привет");

    expect(state.open?.pending).toEqual({ "turn-1": "привет" });
  });

  it("drops it when the turn starts, so the line is not doubled", () => {
    const submitted = applyPendingTurn(opened(), "0199", "turn-1", "привет");
    const started = applySessionDelta(submitted, "0199", "turn-1", {
      kind: "phase",
      phase: "turn",
    }).state;

    expect(started.open?.pending).toEqual({});
  });

  it("keeps it when the daemon only confirms that the turn is still queued", () => {
    // Постановка в очередь сама даёт `phase: queued`; это ещё не начало турна, и записи реплики
    // в дереве пока нет. Снять pending здесь — оставить очередь без текста.
    const submitted = applyPendingTurn(opened(), "0199", "turn-1", "привет");
    const queued = applySessionDelta(submitted, "0199", "turn-1", {
      kind: "phase",
      phase: "queued",
    }).state;

    expect(queued.open?.pending).toEqual({ "turn-1": "привет" });
  });

  it("drops it when a fresh snapshot says the queued turn was cancelled", () => {
    // Снятый с очереди турн не даёт финальной дельты; его единственный исход — снимок `idle`.
    const submitted = applySummary(
      applyPendingTurn(opened(), "0199", "turn-1", "привет"),
      "0199",
      session({ phase: "queued" }),
    );
    const cancelled = applySummary(submitted, "0199", session({ phase: "idle" }));

    expect(cancelled.open?.pending).toEqual({});
  });

  it("keeps a turn that is still waiting while another one runs", () => {
    const submitted = applyPendingTurn(
      applyPendingTurn(opened(), "0199", "turn-1", "первый"),
      "0199",
      "turn-2",
      "второй",
    );
    const started = applySessionDelta(submitted, "0199", "turn-1", {
      kind: "phase",
      phase: "turn",
    }).state;

    expect(started.open?.pending).toEqual({ "turn-2": "второй" });
  });
});

describe("a stream that came back", () => {
  it("throws away the buffer and reads the history from the start", () => {
    // Дельты за время разрыва не лежат ни в окне догона, ни на шине; курсор указывает в середину
    // того, чего мы не видели, — значит начинать надо заново.
    const running = applySessionDelta(
      applyEntries(opened(), "0199", [entry("a")], 4),
      "0199",
      "turn-1",
      { kind: "message-start", messageId: "turn-1:1", role: "agent" },
    ).state;

    const after = reconnected(running);

    expect(after.open?.live).toBeUndefined();
    expect(after.open?.entries).toEqual([]);
    expect(after.open?.seen).toBe(0);
    expect(after.open?.loading).toBe(true);
  });

  it("does nothing when no session is open", () => {
    const state = applySessions(initialSessionsState, { sessions: [] });

    expect(reconnected(state)).toBe(state);
  });
});

describe("events of the bus", () => {
  it("asks for a fresh snapshot on the one event sessions have", () => {
    expect(
      applyStreamEvent(initialSessionsState, {
        index: 1,
        time: "2026-07-29T00:00:00.000Z",
        type: coreEventTypes.sessionsChanged,
        payload: {},
      } as never).sessions,
    ).toBe(true);
  });

  it("asks for a fresh snapshot after a gap in the stream", () => {
    expect(
      applyStreamEvent(initialSessionsState, {
        index: 1,
        time: "2026-07-29T00:00:00.000Z",
        type: "core.stream.gap",
        payload: {},
      } as never).sessions,
    ).toBe(true);
  });

  it("leaves an unrelated core event alone", () => {
    expect(
      applyStreamEvent(initialSessionsState, {
        index: 1,
        time: "2026-07-29T00:00:00.000Z",
        type: coreEventTypes.projectsChanged,
        payload: {},
      } as never).sessions,
    ).toBe(false);
  });
});

describe("isBusy", () => {
  it("reads the phase, because a queued turn has no deltas to read", () => {
    expect(isBusy(session({ phase: "idle" }))).toBe(false);
    expect(isBusy(session({ phase: "queued" }))).toBe(true);
    expect(isBusy(session({ phase: "turn" }))).toBe(true);
    expect(isBusy(undefined)).toBe(false);
  });
});
