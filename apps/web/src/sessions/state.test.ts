import { coreEventTypes, type Session, type SessionEntry } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyBranch,
  applyContext,
  applyDegradation,
  applyEntries,
  applyPendingTurn,
  applySessionDelta,
  applySessions,
  applyStreamEvent,
  applySummary,
  buildEntryTree,
  closeSession,
  entryPath,
  initialSessionsState,
  isBusy,
  isFeedEntry,
  openSession,
  reconnected,
  showArchived,
  type SessionsState,
} from "./state.ts";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "0199",
  projectId: "b7Kq",
  folder: "/code/platform",
  agentId: "base-agent.agent",
  agentAvailable: true,
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  phase: "idle",
  archived: false,
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

describe("what the feed shows", () => {
  const of = (kind: SessionEntry["kind"], rest: Record<string, unknown> = {}): SessionEntry =>
    ({ id: kind, time: "2026-07-29T00:00:00.000Z", kind, ...rest }) as SessionEntry;

  it("keeps the compaction and the summary of a branch visible", () => {
    // Свёртка выбрасывает часть разговора из контекста: не показать её значит оставить агента
    // «забывшим» без единого следа в ленте.
    expect(
      isFeedEntry(of("compaction", { summary: "было так", tokensBefore: 40000, fromHook: true })),
    ).toBe(true);
    expect(
      isFeedEntry(of("branch-summary", { fromId: "e1", summary: "ушли туда", fromHook: false })),
    ).toBe(true);
  });

  it("shows a message of the application only while it asks to be shown", () => {
    expect(
      isFeedEntry(of("custom-message", { type: "note", text: "к сведению", display: true })),
    ).toBe(true);
    expect(
      isFeedEntry(of("custom-message", { type: "note", text: "к сведению", display: false })),
    ).toBe(false);
  });

  it("keeps the bookkeeping of the tree out of the conversation", () => {
    // Метка, лист и имя сессии — состояние дерева, а не реплики; `custom` модели не показана вовсе.
    expect(isFeedEntry(of("label", { targetId: "e1", label: "тут" }))).toBe(false);
    expect(isFeedEntry(of("leaf", { targetId: "e1" }))).toBe(false);
    expect(isFeedEntry(of("session-name", { name: "разбор бага" }))).toBe(false);
    expect(isFeedEntry(of("custom", { type: "core.degraded" }))).toBe(false);
    expect(isFeedEntry(of("tools-change", { toolNames: [] }))).toBe(false);
    expect(isFeedEntry(of("other", { type: "unknown-to-us" }))).toBe(false);
    // Вывод инструмента показывает сам вызов, найдя его по `toolCallId`.
    expect(
      isFeedEntry(
        of("tool-result", { toolCallId: "c1", toolName: "bash", text: "", failed: false }),
      ),
    ).toBe(false);
  });

  it("keeps replies and the settings said aloud", () => {
    expect(isFeedEntry(entry("m1"))).toBe(true);
    expect(isFeedEntry(of("model-change", { model: "anthropic/claude" }))).toBe(true);
    expect(isFeedEntry(of("thinking-level-change", { thinkingLevel: "high" }))).toBe(true);
  });
});

describe("the marks of the entries", () => {
  const marking = (id: string, targetId: string, label?: string): SessionEntry => ({
    id,
    time: "2026-07-29T00:00:00.000Z",
    kind: "label",
    targetId,
    ...(label === undefined ? {} : { label }),
  });

  it("folds the marks of the read entries into what holds right now", () => {
    const state = applyEntries(opened(), "0199", [entry("m1"), marking("l1", "m1", "тут")], 2);

    expect(state.open?.labels.get("m1")).toBe("тут");
  });

  it("takes a mark written without a value for a removal, not for an empty one", () => {
    // Снятие рантайм пишет такой же записью: действующее значение — свёртка, а не наличие записи.
    const marked = applyEntries(opened(), "0199", [entry("m1"), marking("l1", "m1", "тут")], 2);
    const cleared = applyEntries(marked, "0199", [marking("l2", "m1")], 3);

    expect(cleared.open?.labels.has("m1")).toBe(false);
  });

  it("folds over the whole feed, so a page cannot lose the order of two writes", () => {
    const state = applyEntries(
      applyEntries(opened(), "0199", [marking("l1", "m1", "первая")], 1),
      "0199",
      [marking("l2", "m1"), marking("l3", "m1", "вторая")],
      3,
    );

    expect(state.open?.labels.get("m1")).toBe("вторая");
  });

  it("forgets the marks when the feed is read from the start again", () => {
    const marked = applyEntries(opened(), "0199", [marking("l1", "m1", "тут")], 1);

    expect(reconnected(marked).open?.labels.size).toBe(0);
  });
});

describe("the tree of entries", () => {
  const at = (id: string, parentId?: string): SessionEntry => ({
    id,
    ...(parentId === undefined ? {} : { parentId }),
    time: "2026-07-29T00:00:00.000Z",
    kind: "message",
    role: "agent",
    content: [{ kind: "text", text: id }],
  });

  /** Форма дерева одной строкой: `a(b,c)` — у `a` двое детей. Так видно уровень, а не только связь. */
  const shape = (nodes: ReturnType<typeof buildEntryTree>): string =>
    nodes
      .map(({ entry, children }) =>
        children.length === 0 ? entry.id : `${entry.id}(${shape(children)})`,
      )
      .join(",");

  it("lays a linear conversation flat: a hundred replies are not a hundred levels", () => {
    // У каждой записи ровно один ребёнок — уровень тут добавлять не за что.
    const tree = buildEntryTree([at("e1"), at("e2", "e1"), at("e3", "e2"), at("e4", "e3")]);

    expect(shape(tree)).toBe("e1,e2,e3,e4");
    expect(tree.every(({ children }) => children.length === 0)).toBe(true);
  });

  it("adds a level only where the conversation forked", () => {
    // e2 переспросили иначе: две ветки, и каждая уезжает под свою первую запись.
    const tree = buildEntryTree([
      at("e1"),
      at("e2", "e1"),
      at("a1", "e2"),
      at("a2", "a1"),
      at("b1", "e2"),
      at("b2", "b1"),
    ]);

    expect(shape(tree)).toBe("e1,e2(a1(a2),b1(b2))");
  });

  it("keeps the runs of two branches apart instead of mixing them on one level", () => {
    const tree = buildEntryTree([
      at("root"),
      at("a1", "root"),
      at("b1", "root"),
      at("a2", "a1"),
      at("b2", "b1"),
      at("a3", "a2"),
    ]);

    const [rootNode] = tree;

    expect(rootNode?.children.map(({ entry }) => entry.id)).toEqual(["a1", "b1"]);
    expect(shape(rootNode?.children[0]?.children ?? [])).toBe("a2,a3");
  });

  it("keeps an entry whose parent was not read as a root of its own", () => {
    // Пропасть из дерева она не имеет права: родитель либо обрезан, либо ещё не доехал.
    const tree = buildEntryTree([at("e2", "gone"), at("e3", "e2")]);

    expect(shape(tree)).toBe("e2,e3");
  });

  it("does not loop forever on a ring of parents, and loses no entry to it", () => {
    // Корня у кольца нет вовсе, и без доводки дерево вышло бы пустым: записи пропали бы молча.
    expect(shape(buildEntryTree([at("e1", "e2"), at("e2", "e1")]))).toBe("e1,e2");
  });

  it("gives the path from the root to the leaf, so the branch opens expanded", () => {
    const entries = [at("e1"), at("e2", "e1"), at("a1", "e2"), at("b1", "e2"), at("b2", "b1")];

    expect(entryPath(entries, "b2")).toEqual(["e1", "e2", "b1", "b2"]);
    expect(entryPath(entries, undefined)).toEqual([]);
  });
});

describe("the leaf of the session", () => {
  it("takes the leaf and its entry ids out of the branch, leaving its entries alone", () => {
    // Записи ветки — те же, что уже прочитаны курсором: вторая их копия развела бы дерево с лентой.
    const state = applyBranch(opened(), "0199", {
      sessionId: "0199",
      entries: [entry("a"), entry("b")],
      leafId: "b",
    });

    expect(state.open?.leafId).toBe("b");
    expect([...(state.open?.branchEntryIds ?? new Set()).values()]).toEqual(["a", "b"]);
    expect(state.open?.entries).toEqual([]);
  });

  it("forgets the leaf when the stream comes back: it could have moved", () => {
    const known = applyBranch(opened(), "0199", {
      sessionId: "0199",
      entries: [],
      leafId: "b",
    });

    expect(reconnected(known).open?.leafId).toBeUndefined();
    expect(reconnected(known).open?.branchEntryIds).toEqual(new Set());
  });

  it("ignores a branch of a session nobody is looking at", () => {
    const state = opened();

    expect(applyBranch(state, "0200", { sessionId: "0200", entries: [] })).toBe(state);
  });
});

describe("how full the context is", () => {
  it("keeps what the daemon answered where the view can show it", () => {
    const state = applyContext(opened(), "0199", {
      sessionId: "0199",
      tokens: 4096,
      contextWindow: 200000,
      threshold: 0.8,
    });

    expect(state.open?.context?.tokens).toBe(4096);
    expect(state.open?.context?.threshold).toBe(0.8);
  });

  it("drops the number when the session is gone: it is about nothing now", () => {
    const known = applyContext(opened(), "0199", {
      sessionId: "0199",
      tokens: 4096,
      threshold: 0,
    });

    expect(applyContext(known, "0199", undefined).open?.context).toBeUndefined();
  });

  it("ignores an answer about a session nobody is looking at", () => {
    const state = opened();

    expect(applyContext(state, "0200", { sessionId: "0200", tokens: 1, threshold: 0 })).toBe(state);
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

describe("the queues, the counters and what the session lost", () => {
  const opened = (): SessionsState =>
    openSession(
      applySessions(initialSessionsState, {
        sessions: [session()],
      }),
      "0199",
    );

  it("shows what waits in the queues, replacing it wholesale", () => {
    const first = applySessionDelta(opened(), "0199", "turn-1", {
      kind: "queues",
      queues: { steer: ["левее"], followUp: [], nextTurn: [] },
    });

    expect(first.state.open?.queues?.steer).toEqual(["левее"]);
    // Дельта несёт всё, что ждёт прямо сейчас: опустевшая очередь опустошает и показанное.
    expect(first.reread).toBe(false);

    const drained = applySessionDelta(first.state, "0199", "turn-1", {
      kind: "queues",
      queues: { steer: [], followUp: [], nextTurn: ["потом"] },
    });

    expect(drained.state.open?.queues).toEqual({ steer: [], followUp: [], nextTurn: ["потом"] });
  });

  it("forgets the queues when the stream comes back, because their deltas are gone", () => {
    const queued = applySessionDelta(opened(), "0199", "turn-1", {
      kind: "queues",
      queues: { steer: ["левее"], followUp: [], nextTurn: [] },
    }).state;

    expect(reconnected(queued).open?.queues).toBeUndefined();
  });

  it("keeps every loss, not only the last one", () => {
    const lost = applyDegradation(
      applyDegradation(opened(), "0199", { kind: "tool", name: "bash" }),
      "0199",
      { kind: "tool", name: "write" },
    );

    // За одну пересборку набора пропасть может несколько инструментов, и замена стёрла бы остальные.
    expect(lost.open?.degradations).toEqual([
      { kind: "tool", name: "bash" },
      { kind: "tool", name: "write" },
    ]);
  });

  it("takes a loss in another session as none of its business", () => {
    expect(
      applyDegradation(opened(), "чужая", { kind: "model", name: "m" }).open?.degradations,
    ).toEqual([]);
  });

  it("reads a loss off the bus without asking for the list again", () => {
    const outcome = applyStreamEvent(opened(), {
      index: 1,
      time: "2026-07-29T00:00:00.000Z",
      type: coreEventTypes.sessionDegraded,
      payload: { sessionId: "0199", kind: "tool", name: "bash" },
    } as never);

    expect(outcome.state.open?.degradations).toEqual([{ kind: "tool", name: "bash" }]);
    // Список от этого не меняется: пропала опора сессии, а не сама сессия.
    expect(outcome.sessions).toBe(false);
  });

  it("drops the list when the archive filter flips, so nothing stale is shown", () => {
    const listed = applySessions(initialSessionsState, { sessions: [session()] });
    const flipped = showArchived(listed, true);

    expect(flipped.showArchived).toBe(true);
    expect(flipped.sessions).toBeUndefined();
  });
});
