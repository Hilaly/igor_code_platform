import {
  agentsPath,
  projectAgentsPath,
  sessionBranchPath,
  sessionCompactPath,
  sessionContextPath,
  sessionEntriesPath,
  sessionEntryLabelPath,
  sessionNavigatePath,
  sessionPath,
  sessionTurnsPath,
  sessionsPath,
} from "@sovereign/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSession,
  fetchAgents,
  fetchProjectAgents,
  fetchBranch,
  fetchContextUsage,
  fetchEntries,
  fetchSession,
  fetchSessions,
  interruptTurn,
  navigateTo,
  requestCompaction,
  setEntryLabel,
  submitTurn,
} from "./api.ts";

type Answer = { status: number; body: unknown };

/** Ответ демона подставляется целиком: проверяется разбор отказа, а не сеть. */
function daemon(answer: Answer) {
  const calls: { url: string; init?: RequestInit }[] = [];

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });

    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    });
  });

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading sessions", () => {
  it("asks for the agents that are enabled right now", async () => {
    const calls = daemon({ status: 200, body: { agents: [] } });

    await expect(fetchAgents()).resolves.toEqual({ agents: [] });
    expect(calls[0]?.url).toBe(agentsPath);
  });

  it("asks for the agents resolved within one escaped project", async () => {
    const calls = daemon({ status: 200, body: { agents: [{ id: "review" }] } });

    await expect(fetchProjectAgents("p/1")).resolves.toEqual({ agents: [{ id: "review" }] });
    expect(calls[0]?.url).toBe(projectAgentsPath("p/1"));
    expect(calls[0]?.url).toBe("/api/projects/p%2F1/agents");
  });

  it("carries a missing project's reason from the project agents endpoint", async () => {
    daemon({ status: 404, body: { error: "not found" } });

    await expect(fetchProjectAgents("gone")).rejects.toThrow("not found");
  });

  it("forwards cancellation to the project agents request", async () => {
    const calls = daemon({ status: 200, body: { agents: [] } });
    const controller = new AbortController();

    await fetchProjectAgents("p1", controller.signal);

    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  it("narrows the list to one project by a query parameter", async () => {
    const calls = daemon({ status: 200, body: { sessions: [] } });

    await fetchSessions("b7Kq3xv9pQdT");

    expect(calls[0]?.url).toBe(`${sessionsPath}?projectId=b7Kq3xv9pQdT`);
  });

  it("asks for every session when no project is named", async () => {
    const calls = daemon({ status: 200, body: { sessions: [] } });

    await fetchSessions();

    expect(calls[0]?.url).toBe(sessionsPath);
  });

  it("takes a missing session for an empty answer, not for a failure", async () => {
    // Ссылку могли открыть после того, как проект ушёл в архив: адрес остался, сессии нет.
    daemon({ status: 404, body: { error: "no such session" } });

    await expect(fetchSession("0199")).resolves.toBeUndefined();
  });

  it("carries the reason of the daemon instead of the bare code", async () => {
    daemon({ status: 500, body: { error: "the session file is not readable" } });

    await expect(fetchSession("0199")).rejects.toThrow("the session file is not readable");
  });

  it("names the code when the answer has no reason in it", async () => {
    daemon({ status: 502, body: {} });

    await expect(fetchSessions()).rejects.toThrow("the daemon answered 502");
  });

  it("reads entries from the cursor the previous page gave back", async () => {
    // Курсор считается в записях рантайма: длина уже показанного списка ему не равна.
    const calls = daemon({ status: 200, body: { sessionId: "0199", entries: [], seen: 12 } });

    await expect(fetchEntries("0199", 7)).resolves.toEqual({
      sessionId: "0199",
      entries: [],
      seen: 12,
    });
    expect(calls[0]?.url).toBe(`${sessionEntriesPath("0199")}?after=7`);
  });

  it("reads the branch of the current leaf when no entry is named", async () => {
    // Ветка без `from` — тот разговор, который увидит модель на следующем турне.
    const calls = daemon({ status: 200, body: { sessionId: "0199", entries: [], leafId: "e9" } });

    await expect(fetchBranch("0199")).resolves.toEqual({
      sessionId: "0199",
      entries: [],
      leafId: "e9",
    });
    expect(calls[0]?.url).toBe(sessionBranchPath("0199"));
  });

  it("reads the branch of a named entry through the query parameter", async () => {
    const calls = daemon({ status: 200, body: { sessionId: "0199", entries: [] } });

    await fetchBranch("0199", "e/7");

    expect(calls[0]?.url).toBe(sessionBranchPath("0199", "e/7"));
    expect(calls[0]?.url).toContain("from=e%2F7");
  });

  it("takes a missing session for no branch at all, not for a failure", async () => {
    daemon({ status: 404, body: { error: "no such session" } });

    await expect(fetchBranch("0199")).resolves.toBeUndefined();
  });

  it("reads how full the context is, keeping an unknown window absent", async () => {
    // Окна модели может не быть вовсе: тогда доли не существует, и выдумывать её нечем.
    const calls = daemon({
      status: 200,
      body: { sessionId: "0199", tokens: 4096, threshold: 0.8 },
    });

    await expect(fetchContextUsage("0199")).resolves.toEqual({
      sessionId: "0199",
      tokens: 4096,
      threshold: 0.8,
    });
    expect(calls[0]?.url).toBe(sessionContextPath("0199"));
  });

  it("escapes the session identifier in the address", async () => {
    const calls = daemon({ status: 200, body: {} });

    await fetchSession("a/b");

    expect(calls[0]?.url).toBe(sessionPath("a/b"));
    expect(calls[0]?.url).not.toContain("a/b");
  });
});

describe("changing sessions", () => {
  it("creates a session and gives back the bare record", async () => {
    const calls = daemon({ status: 201, body: { id: "0199", projectId: "b7Kq" } });

    await expect(createSession({ projectId: "b7Kq", agentId: "starter.generic" })).resolves.toEqual(
      {
        kind: "created",
        session: { id: "0199", projectId: "b7Kq" },
      },
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"projectId":"b7Kq","agentId":"starter.generic"}');
  });

  it("turns a refusal into an outcome, not into an exception", async () => {
    // Причина `409` — то, что вью показывает человеку: падать на ней значит потерять её.
    daemon({ status: 409, body: { error: "the project is archived" } });

    await expect(createSession({ projectId: "b7Kq", agentId: "a" })).resolves.toEqual({
      kind: "refused",
      reason: "the project is archived",
    });
  });

  it("submits a turn and carries the phase the daemon answered with", async () => {
    // `queued` в ответе означает, что турн принят, но ещё не начат: спрятать это нельзя.
    const calls = daemon({
      status: 202,
      body: { sessionId: "0199", turnId: "turn-2", phase: "queued" },
    });

    await expect(submitTurn("0199", { text: "привет" })).resolves.toEqual({
      kind: "accepted",
      accepted: { sessionId: "0199", turnId: "turn-2", phase: "queued" },
    });
    expect(calls[0]?.url).toBe(sessionTurnsPath("0199"));
    expect(calls[0]?.init?.body).toBe('{"text":"привет"}');
  });

  it("turns a busy session into a refusal with its reason", async () => {
    daemon({ status: 409, body: { error: "the session is busy" } });

    await expect(submitTurn("0199", { text: "привет" })).resolves.toEqual({
      kind: "refused",
      reason: "the session is busy",
    });
  });

  it("interrupts over the turns collection and keeps a false outcome as it is", async () => {
    // «Прерывать было нечего» — не ошибка: турн мог закончиться сам между нажатием и запросом.
    const calls = daemon({ status: 200, body: { sessionId: "0199", interrupted: false } });

    await expect(interruptTurn("0199")).resolves.toEqual({
      sessionId: "0199",
      interrupted: false,
    });
    expect(calls[0]?.init?.method).toBe("DELETE");
    // Заголовок обязателен и у запроса без тела: диспетчер требует его от всякого изменяющего.
    expect(calls[0]?.init?.headers).toEqual({ "content-type": "application/json" });
  });

  it("takes a missing session for nothing to interrupt", async () => {
    daemon({ status: 404, body: { error: "no such session" } });

    await expect(interruptTurn("0199")).resolves.toBeUndefined();
  });
});

describe("the context of a session", () => {
  it("asks for a compaction without instructions and carries the phase back", async () => {
    // Как и у турна, `queued` значит «принято, но ещё не начато»: компакция идёт той же очередью.
    const calls = daemon({ status: 202, body: { sessionId: "0199", phase: "queued" } });

    await expect(requestCompaction("0199")).resolves.toEqual({
      kind: "accepted",
      accepted: { sessionId: "0199", phase: "queued" },
    });
    expect(calls[0]?.url).toBe(sessionCompactPath("0199"));
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe("{}");
  });

  it("carries the instructions of the summary when they were given", async () => {
    const calls = daemon({ status: 202, body: { sessionId: "0199", phase: "compaction" } });

    await requestCompaction("0199", "сохрани решения");

    expect(calls[0]?.init?.body).toBe('{"instructions":"сохрани решения"}');
  });

  it("turns a busy session into a refusal instead of an exception", async () => {
    daemon({ status: 409, body: { error: "the session is busy" } });

    await expect(requestCompaction("0199")).resolves.toEqual({
      kind: "refused",
      reason: "the session is busy",
    });
  });

  it("navigates to an entry and carries the text of the human back", async () => {
    // Цель — реплика человека: рантайм ставит листом её родителя и отдаёт текст, чтобы переспросить.
    const calls = daemon({
      status: 200,
      body: { sessionId: "0199", leafId: "e6", editorText: "вопрос", summarized: false },
    });

    await expect(navigateTo("0199", { entryId: "e7" })).resolves.toEqual({
      kind: "navigated",
      navigated: { sessionId: "0199", leafId: "e6", editorText: "вопрос", summarized: false },
    });
    expect(calls[0]?.url).toBe(sessionNavigatePath("0199"));
    expect(calls[0]?.init?.body).toBe('{"entryId":"e7"}');
  });

  it("asks for the summary of the branch it leaves when told to", async () => {
    const calls = daemon({ status: 200, body: { sessionId: "0199", summarized: true } });

    await navigateTo("0199", { entryId: "e7", summarize: true, instructions: "коротко" });

    expect(calls[0]?.init?.body).toBe('{"entryId":"e7","summarize":true,"instructions":"коротко"}');
  });

  it("writes the mark of an entry wholesale, escaping its identifier", async () => {
    const calls = daemon({
      status: 200,
      body: { sessionId: "0199", entryId: "e/7", label: "тут" },
    });

    await expect(setEntryLabel("0199", "e/7", "тут")).resolves.toEqual({
      kind: "labelled",
      labelled: { sessionId: "0199", entryId: "e/7", label: "тут" },
    });
    expect(calls[0]?.url).toBe(sessionEntryLabelPath("0199", "e/7"));
    expect(calls[0]?.url).not.toContain("e/7");
    expect(calls[0]?.init?.method).toBe("PUT");
  });

  it("says the removal of a mark with an explicit null, not with an absent key", async () => {
    // Отсутствующий ключ значил бы «не трогать», а «не трогать» у целой записи — не операция.
    const calls = daemon({ status: 200, body: { sessionId: "0199", entryId: "e7" } });

    await expect(setEntryLabel("0199", "e7", null)).resolves.toEqual({
      kind: "labelled",
      labelled: { sessionId: "0199", entryId: "e7" },
    });
    expect(calls[0]?.init?.body).toBe('{"label":null}');
  });

  it("turns a refused mark into an outcome the view can show", async () => {
    daemon({ status: 409, body: { error: "the session is archived" } });

    await expect(setEntryLabel("0199", "e7", "тут")).resolves.toEqual({
      kind: "refused",
      reason: "the session is archived",
    });
  });
});
