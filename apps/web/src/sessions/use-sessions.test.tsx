// @vitest-environment jsdom

/**
 * Связь вью сессий с демоном на настоящем React: правила применения проверены отдельно
 * (`state.test.ts`), а здесь — проводка, которой у правил нет.
 *
 * Главное тут — две ловушки контракта, каждая из которых правилом не ловится, потому что правило не
 * знает, кто и когда его позовёт: дельты чужой сессии, которые демон рассылает всем клиентам, и
 * турн, прерванный в очереди, — он не даёт ни одной дельты, и починить ожидание может только снимок.
 */

import {
  agentsPath,
  coreEventTypes,
  sessionBranchPath,
  sessionCompactPath,
  sessionContextPath,
  sessionDeltaFrameKind,
  sessionEntriesPath,
  sessionEntryLabelPath,
  sessionForkPath,
  sessionMessagesPath,
  sessionNavigatePath,
  sessionPath,
  sessionTurnsPath,
  sessionsPath,
  type Session,
  type SessionContextUsage,
  type SessionDeltaFrame,
  type SessionEntriesPage,
  type SessionEntry,
} from "@sovereign/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { useSessions } from "./use-sessions.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "0199",
  projectId: "b7Kq",
  folder: "/code/platform",
  agentId: "base-agent.agent",
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  phase: "idle",
  archived: false,
  createdAt: "2026-07-29T00:00:00.000Z",
  ...overrides,
});

const frame = (overrides: Partial<SessionDeltaFrame> = {}): SessionDeltaFrame => ({
  frame: sessionDeltaFrameKind,
  time: "2026-07-29T00:00:00.000Z",
  sessionId: "0199",
  turnId: "turn-1",
  delta: { kind: "message-delta", messageId: "turn-1:1", channel: "text", text: "привет" },
  ...overrides,
});

const entry = (id: string): SessionEntry => ({
  id,
  time: "2026-07-29T00:00:00.000Z",
  kind: "message",
  role: "agent",
  content: [{ kind: "text", text: id }],
});

type Call = { url: string; method: string; body?: string; signal?: AbortSignal | null };

let calls: Call[] = [];
let sessions: Session[] = [session()];
let page: SessionEntriesPage = { sessionId: "0199", entries: [], seen: 0 };
let context: SessionContextUsage = { sessionId: "0199", tokens: 0, threshold: 0 };
let delayedBranch: Promise<Response> | undefined;
let delayedBranches: Promise<Response>[] | undefined;
let delayedEntries: Promise<Response> | undefined;
/** Ответ на всё, что не снимок: путь и код подставляет тест. */
let refusals: Record<string, { status: number; body: unknown }> = {};

const answer = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);

beforeEach(() => {
  calls = [];
  sessions = [session()];
  page = { sessionId: "0199", entries: [], seen: 0 };
  context = { sessionId: "0199", tokens: 0, threshold: 0 };
  refusals = {};
  delayedBranch = undefined;
  delayedBranches = undefined;
  delayedEntries = undefined;

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    calls.push({
      url,
      method,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
      ...(init?.signal === undefined ? {} : { signal: init.signal }),
    });

    const refusal = refusals[`${method} ${url}`];

    if (refusal !== undefined) {
      return answer(refusal.body, refusal.status);
    }

    if (url === sessionsPath && method === "GET") {
      return answer({ sessions });
    }

    if (url === agentsPath) {
      return answer({ agents: [] });
    }

    if (url === sessionPath("0199")) {
      const found = sessions.find(({ id }) => id === "0199");

      return found === undefined ? answer({ error: "no such session" }, 404) : answer(found);
    }

    if (url === sessionContextPath("0199")) {
      return answer(context);
    }

    if (url.startsWith(sessionBranchPath("0199"))) {
      const delayed = delayedBranches?.shift();

      if (delayed !== undefined) {
        return delayed;
      }

      if (delayedBranch !== undefined) {
        return delayedBranch;
      }

      return answer({ sessionId: "0199", entries: [] });
    }

    if (url.startsWith(sessionEntriesPath("0199"))) {
      if (delayedEntries !== undefined) {
        return delayedEntries;
      }

      return answer(page);
    }

    return answer({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function connect(props: { stream?: StreamStatus; sessionId?: string } = {}) {
  const bus = createFrontendBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const diagnostics: string[] = [];
  const record = (diagnostic: string): void => {
    diagnostics.push(diagnostic);
  };
  const view = renderHook(
    (current: { stream: StreamStatus; sessionId?: string }) =>
      useSessions({
        bus,
        stream: current.stream,
        onDiagnostic: record,
        ...(current.sessionId === undefined ? {} : { sessionId: current.sessionId }),
      }),
    { initialProps: { stream: props.stream ?? "open", ...props } },
  );

  return { ...view, bus, diagnostics };
}

const asked = (url: string, method = "GET"): Call[] =>
  calls.filter((call) => call.url === url && call.method === method);

describe("useSessions", () => {
  it("asks for the sessions and the agents as soon as the stream is up", async () => {
    const view = connect({ stream: "connecting" });

    expect(calls).toEqual([]);

    view.rerender({ stream: "open" });

    await waitFor(() => expect(view.result.current.state.sessions).toHaveLength(1));
    expect(asked(agentsPath)).toHaveLength(1);
  });

  it("reads the entries of the session named by the address", async () => {
    page = { sessionId: "0199", entries: [], seen: 4 };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.seen).toBe(4));
    expect(asked(`${sessionEntriesPath("0199")}?after=0`)).toHaveLength(1);
  });

  it("starts the active branch only after the core snapshot applies", async () => {
    let resolveEntries!: (response: Response) => void;
    delayedEntries = new Promise((resolve) => {
      resolveEntries = resolve;
    });

    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(asked(`${sessionEntriesPath("0199")}?after=0`)).toHaveLength(1));
    expect(asked(sessionBranchPath("0199"))).toHaveLength(0);

    resolveEntries(await answer({ sessionId: "0199", entries: [entry("active")], seen: 1 }));
    await waitFor(() => expect(asked(sessionBranchPath("0199"))).toHaveLength(1));
    await waitFor(() => expect(view.result.current.state.open?.seen).toBe(1));
  });

  it("cancels the open session reload when its route closes", async () => {
    let resolveEntries!: (response: Response) => void;
    delayedEntries = new Promise((resolve) => {
      resolveEntries = resolve;
    });
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(asked(`${sessionEntriesPath("0199")}?after=0`)).toHaveLength(1));
    const request = asked(`${sessionEntriesPath("0199")}?after=0`)[0];

    view.rerender({ stream: "reconnecting" });
    expect(request?.signal?.aborted).toBe(true);

    resolveEntries(await answer({ error: "late failure" }, 503));
    await waitFor(() => expect(view.result.current.state.open).toBeUndefined());
    expect(view.diagnostics).toEqual([]);
  });

  it("stops loading when the core snapshot fails", async () => {
    refusals[`GET ${sessionEntriesPath("0199")}?after=0`] = {
      status: 503,
      body: { error: "entries unavailable" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    expect(view.result.current.state.open?.failure).toBe("entries unavailable");
    expect(view.diagnostics).toContain("the session 0199 could not be read: entries unavailable");
  });

  it("cancels a same-session reload when the stream tears down", async () => {
    let resolveEntries!: (response: Response) => void;
    delayedEntries = new Promise((resolve) => {
      resolveEntries = resolve;
    });
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(asked(`${sessionEntriesPath("0199")}?after=0`)).toHaveLength(1));
    const request = asked(`${sessionEntriesPath("0199")}?after=0`)[0];
    view.rerender({ stream: "reconnecting", sessionId: "0199" });
    expect(request?.signal?.aborted).toBe(true);

    resolveEntries(await answer({ error: "late failure" }, 503));
    await waitFor(() => expect(view.result.current.state.open?.failure).toBeUndefined());
  });

  it("takes a session that is gone for an empty panel, not for a failure", async () => {
    // Ссылку могли открыть после того, как сессию удалили: адрес остался в закладках.
    sessions = [];
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    expect(view.result.current.state.open?.summary).toBeUndefined();
  });

  it("ignores a delta that belongs to another session", async () => {
    // Кадры демон рассылает всем клиентам без фильтра: подписки на уровне протокола нет.
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    act(() => {
      view.result.current.receiveSessionDelta(frame({ sessionId: "0200" }));
    });

    expect(view.result.current.state.open?.live).toBeUndefined();
  });

  it("shows the answer as it arrives and reads the entries again when the turn ends", async () => {
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    const before = asked(`${sessionEntriesPath("0199")}?after=0`).length;

    act(() => {
      view.result.current.receiveSessionDelta(frame());
    });

    expect(view.result.current.state.open?.live?.items["turn-1:1"]).toMatchObject({
      text: "привет",
    });

    act(() => {
      view.result.current.receiveSessionDelta(frame({ delta: { kind: "turn-end" } }));
    });

    expect(view.result.current.state.open?.live).toBeUndefined();
    await waitFor(() =>
      expect(asked(`${sessionEntriesPath("0199")}?after=0`).length).toBeGreaterThan(before),
    );
  });

  it("leaves no waiting behind when a queued turn is cancelled without a single delta", async () => {
    // Прерванный в очереди турн отзывается только событием шины. Ожидание, повешенное на дельты,
    // зависло бы навсегда — чинит его снимок.
    refusals[`POST ${sessionTurnsPath("0199")}`] = {
      status: 202,
      body: { sessionId: "0199", turnId: "turn-7", phase: "queued" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    act(() => {
      view.result.current.submitTurn("привет");
    });

    await waitFor(() =>
      expect(view.result.current.state.open?.pending).toEqual({ "turn-7": "привет" }),
    );

    sessions = [session({ phase: "idle" })];
    act(() => {
      view.bus.publish({
        index: 1,
        time: "2026-07-29T00:00:00.000Z",
        type: coreEventTypes.sessionsChanged,
        payload: {},
      } as never);
    });

    await waitFor(() => expect(view.result.current.state.open?.summary?.phase).toBe("idle"));
    expect(view.result.current.state.open?.pending).toEqual({});
  });

  it("shows the text of a submitted turn before the queue got to it", async () => {
    refusals[`POST ${sessionTurnsPath("0199")}`] = {
      status: 202,
      body: { sessionId: "0199", turnId: "turn-7", phase: "queued" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    act(() => {
      view.result.current.submitTurn("привет");
    });

    await waitFor(() =>
      expect(view.result.current.state.open?.pending).toEqual({ "turn-7": "привет" }),
    );
    expect(view.result.current.state.open?.summary?.phase).toBe("queued");
  });

  it("does not double the line of a turn that started at once", async () => {
    // Начатый турн уже пишет запись реплики: вторая копия висела бы в ленте до конца работы.
    refusals[`POST ${sessionTurnsPath("0199")}`] = {
      status: 202,
      body: { sessionId: "0199", turnId: "turn-8", phase: "turn" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    act(() => {
      view.result.current.submitTurn("привет");
    });

    await waitFor(() => expect(view.result.current.state.open?.summary?.phase).toBe("turn"));
    expect(view.result.current.state.open?.pending).toEqual({});
  });

  it("keeps the reason of a refused turn and says it in the diagnostics too", async () => {
    refusals[`POST ${sessionTurnsPath("0199")}`] = {
      status: 409,
      body: { error: "the session is busy" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    act(() => {
      view.result.current.submitTurn("привет");
    });

    await waitFor(() =>
      expect(view.result.current.state.open?.failure).toBe("the session is busy"),
    );
    expect(view.diagnostics).toContain("the turn was refused: the session is busy");
  });

  it("reads everything again after the stream came back, from the very start", async () => {
    // Дельты разрыва не догоняются, и курсор указывает в середину того, чего клиент не видел.
    page = { sessionId: "0199", entries: [], seen: 9 };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.seen).toBe(9));

    view.rerender({ stream: "reconnecting", sessionId: "0199" });
    view.rerender({ stream: "open", sessionId: "0199" });

    await waitFor(() =>
      expect(asked(`${sessionEntriesPath("0199")}?after=0`).length).toBeGreaterThan(1),
    );
  });

  it("interrupts over the turns collection and invents no outcome of its own", async () => {
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    act(() => {
      view.result.current.interrupt();
    });

    await waitFor(() => expect(asked(sessionTurnsPath("0199"), "DELETE")).toHaveLength(1));
    // Ни фазы, ни отказа хук не выдумывает: исход приедет дельтой или событием шины.
    expect(view.result.current.state.open?.failure).toBeUndefined();
  });

  it("gives the refusal of a creation back to the caller instead of throwing", async () => {
    refusals[`POST ${sessionsPath}`] = { status: 409, body: { error: "the project is archived" } };
    const view = connect();

    await waitFor(() => expect(view.result.current.state.sessions).toHaveLength(1));

    let outcome: unknown;
    await act(async () => {
      outcome = await view.result.current.createSession({ projectId: "b7Kq", agentId: "a" });
    });

    expect(outcome).toEqual({ kind: "refused", reason: "the project is archived" });
    expect(view.diagnostics).toContain("the session could not be created: the project is archived");
  });

  it("gives the created fork back so the caller can open it", async () => {
    const forked = session({ id: "0200" });
    refusals[`POST ${sessionForkPath("0199")}`] = {
      status: 200,
      body: forked,
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await view.result.current.forkSession({ entryId: "e1", position: "at" });
    });

    expect(outcome).toEqual({ kind: "done", session: forked });
  });

  it("reads how full the context is together with the snapshot", async () => {
    // Контекст меняется тогда же, когда фаза: спрашивать его отдельным поводом было бы нечем.
    context = { sessionId: "0199", tokens: 4096, contextWindow: 200000, threshold: 0.8 };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.context?.tokens).toBe(4096));
    expect(asked(sessionContextPath("0199"))).toHaveLength(1);
  });

  it("applies the phase an accepted compaction came back with", async () => {
    // Фаза — единственное, что известно сразу: пересказ появится в дереве только к концу компакции,
    // и дочитывать ленту прямо сейчас нечего. Без применения фазы работа выглядела бы простоем.
    refusals[`POST ${sessionCompactPath("0199")}`] = {
      status: 202,
      body: { sessionId: "0199", phase: "compaction" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    let reason: unknown = "не спрошено";
    await act(async () => {
      reason = await view.result.current.compact("сохрани решения");
    });

    expect(reason).toBeUndefined();
    expect(calls.find((call) => call.url === sessionCompactPath("0199"))?.body).toBe(
      '{"instructions":"сохрани решения"}',
    );
    expect(view.result.current.state.open?.summary?.phase).toBe("compaction");
  });

  it("gives the refusal of a compaction back to the caller and says it in the diagnostics", async () => {
    refusals[`POST ${sessionCompactPath("0199")}`] = {
      status: 409,
      body: { error: "the session is busy" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    let reason: unknown;
    await act(async () => {
      reason = await view.result.current.compact();
    });

    expect(reason).toBe("the session is busy");
    expect(view.diagnostics).toContain("the compaction of 0199 was refused: the session is busy");
  });

  it("loads the active branch with the initial session snapshot", async () => {
    // Записи ветки — те же, что уже прочитаны курсором. Вторая их копия развела бы дерево с лентой.
    refusals[`GET ${sessionBranchPath("0199")}`] = {
      status: 200,
      body: { sessionId: "0199", entries: [entry("e1"), entry("e2")], leafId: "e2" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    await waitFor(() => expect(view.result.current.state.open?.leafId).toBe("e2"));
    expect(asked(sessionBranchPath("0199"))).toHaveLength(1);
    expect([...(view.result.current.state.open?.branchEntryIds ?? new Set()).values()]).toEqual([
      "e1",
      "e2",
    ]);
    expect(view.result.current.state.open?.entries).toEqual([]);
  });

  it("keeps the core snapshot usable when the active branch cannot be read", async () => {
    refusals[`GET ${sessionBranchPath("0199")}`] = {
      status: 503,
      body: { error: "branch service unavailable" },
    };
    page = { sessionId: "0199", entries: [entry("inactive")], seen: 1 };

    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.summary?.id).toBe("0199"));
    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    expect(view.result.current.state.open?.branchEntryIds).toEqual(new Set());
    expect(view.result.current.state.open?.entries).toEqual([entry("inactive")]);
    expect(view.diagnostics[0]).toBe(
      "the branch of 0199 could not be read: branch service unavailable",
    );
  });

  it("hides the feed until the initial branch response settles", async () => {
    let resolveBranch!: (response: Response) => void;
    delayedBranch = new Promise((resolve) => {
      resolveBranch = resolve;
    });
    page = { sessionId: "0199", entries: [entry("inactive")], seen: 1 };

    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    expect(view.result.current.state.open?.branchEntryIds).toEqual(new Set());
    resolveBranch(
      await answer({ sessionId: "0199", entries: [entry("active")], leafId: "active" }),
    );
    await waitFor(() => expect(view.result.current.state.open?.leafId).toBe("active"));
  });

  it("clears the old branch while a refreshed branch is pending", async () => {
    refusals[`GET ${sessionBranchPath("0199")}`] = {
      status: 200,
      body: { sessionId: "0199", entries: [entry("old")], leafId: "old" },
    };
    const view = connect({ sessionId: "0199" });
    await waitFor(() => expect(view.result.current.state.open?.leafId).toBe("old"));

    delete refusals[`GET ${sessionBranchPath("0199")}`];
    let resolveBranch!: (response: Response) => void;
    delayedBranch = new Promise((resolve) => {
      resolveBranch = resolve;
    });
    view.rerender({ stream: "reconnecting", sessionId: "0199" });
    view.rerender({ stream: "open", sessionId: "0199" });
    await waitFor(() => expect(view.result.current.state.open?.branchEntryIds).toEqual(new Set()));

    resolveBranch(await answer({ sessionId: "0199", entries: [entry("new")], leafId: "new" }));
    await waitFor(() => expect(view.result.current.state.open?.leafId).toBe("new"));
  });

  it("ignores an aborted branch response that arrives after its replacement", async () => {
    let resolveOld!: (response: Response) => void;
    const oldBranch = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    let resolveFresh!: (response: Response) => void;
    const freshBranch = new Promise<Response>((resolve) => {
      resolveFresh = resolve;
    });
    delayedBranches = [oldBranch, freshBranch];

    const view = connect({ sessionId: "0199" });
    await waitFor(() => expect(asked(sessionBranchPath("0199"))).toHaveLength(1));

    view.rerender({ stream: "reconnecting", sessionId: "0199" });
    view.rerender({ stream: "open", sessionId: "0199" });
    await waitFor(() => expect(asked(sessionBranchPath("0199"))).toHaveLength(2));

    await act(async () => {
      resolveFresh(await answer({ sessionId: "0199", entries: [entry("fresh")], leafId: "fresh" }));
    });
    await waitFor(() => expect(view.result.current.state.open?.leafId).toBe("fresh"));

    await act(async () => {
      resolveOld(await answer({ sessionId: "0199", entries: [entry("old")], leafId: "old" }));
    });
    expect(view.result.current.state.open?.leafId).toBe("fresh");
  });

  it("reads the feed and the branch again after a move, because the leaf is elsewhere now", async () => {
    refusals[`POST ${sessionNavigatePath("0199")}`] = {
      status: 200,
      body: { sessionId: "0199", leafId: "e6", editorText: "вопрос", summarized: false },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    const before = asked(`${sessionEntriesPath("0199")}?after=0`).length;

    let outcome: unknown;
    await act(async () => {
      outcome = await view.result.current.navigate({ entryId: "e7" });
    });

    // Текст реплики отдаётся вызывающему: подставить его в композер — дело вью, а не связи.
    expect(outcome).toEqual({
      kind: "navigated",
      navigated: { sessionId: "0199", leafId: "e6", editorText: "вопрос", summarized: false },
    });
    await waitFor(() =>
      expect(asked(`${sessionEntriesPath("0199")}?after=0`).length).toBeGreaterThan(before),
    );
    expect(asked(sessionBranchPath("0199"))).toHaveLength(2);
  });

  it("gives the refusal of a move back and reads nothing again", async () => {
    refusals[`POST ${sessionNavigatePath("0199")}`] = {
      status: 409,
      body: { error: "the session is busy" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await view.result.current.navigate({ entryId: "e7" });
    });

    expect(outcome).toEqual({ kind: "refused", reason: "the session is busy" });
    expect(view.diagnostics).toContain("the navigation in 0199 was refused: the session is busy");
    // Лист остался прежним, и перечитывать было нечего.
    expect(asked(sessionBranchPath("0199"))).toHaveLength(1);
  });

  it("reads the feed again after a mark, because the mark is an entry of the tree", async () => {
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    const before = asked(`${sessionEntriesPath("0199")}?after=0`).length;

    await act(async () => {
      await view.result.current.setEntryLabel("e7", "тут");
    });

    expect(asked(sessionEntryLabelPath("0199", "e7"), "PUT")).toHaveLength(1);
    await waitFor(() =>
      expect(asked(`${sessionEntriesPath("0199")}?after=0`).length).toBeGreaterThan(before),
    );
  });

  it("gives the refusal of a mark back instead of throwing", async () => {
    refusals[`PUT ${sessionEntryLabelPath("0199", "e7")}`] = {
      status: 409,
      body: { error: "the session is archived" },
    };
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));

    let reason: unknown;
    await act(async () => {
      reason = await view.result.current.setEntryLabel("e7", null);
    });

    expect(reason).toBe("the session is archived");
    expect(view.diagnostics).toContain(
      "the entry e7 could not be labelled: the session is archived",
    );
  });

  it("reads the open entries again after an appended message", async () => {
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.loading).toBe(false));
    const before = asked(`${sessionEntriesPath("0199")}?after=0`).length;

    await act(async () => {
      await view.result.current.sendMessage({ text: "ещё контекст", mode: "append" });
    });

    expect(asked(sessionMessagesPath("0199"), "POST")).toHaveLength(1);
    await waitFor(() =>
      expect(asked(`${sessionEntriesPath("0199")}?after=0`).length).toBeGreaterThan(before),
    );
  });
});
