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
  sessionDeltaFrameKind,
  sessionEntriesPath,
  sessionPath,
  sessionTurnsPath,
  sessionsPath,
  type Session,
  type SessionDeltaFrame,
  type SessionEntriesPage,
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

type Call = { url: string; method: string; body?: string };

let calls: Call[] = [];
let sessions: Session[] = [session()];
let page: SessionEntriesPage = { sessionId: "0199", entries: [], seen: 0 };
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
  refusals = {};

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    calls.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });

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

    if (url.startsWith(sessionEntriesPath("0199"))) {
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
    sessions = [session({ phase: "queued" })];
    const view = connect({ sessionId: "0199" });

    await waitFor(() => expect(view.result.current.state.open?.summary?.phase).toBe("queued"));

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
});
