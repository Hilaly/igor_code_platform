// @vitest-environment jsdom

import { BrowserRuntimeProvider } from "@sovereign/browser-sdk/host";
import type { PlaceContext } from "@sovereign/browser-sdk";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SubagentsPanel } from "./browser.tsx";
import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import type { SubagentDetail, SubagentListed } from "./routes.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const listed = (overrides: Partial<SubagentListed> = {}): SubagentListed => ({
  sessionId: "s-child",
  parentSessionId: "s-parent",
  projectId: "p1",
  agentId: "starter.generic",
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  description: "check the tests",
  prompt: "run the tests",
  state: "finished",
  startedAt: "2026-08-14T09:00:00.000Z",
  lastResponse: "all green, nothing broke",
  ...overrides,
});

const detail: SubagentDetail = {
  record: listed(),
  entries: [
    {
      id: "e1",
      time: "2026-08-14T09:00:01.000Z",
      kind: "message",
      role: "user",
      content: [{ kind: "text", text: "run the tests" }],
    },
    {
      id: "e2",
      time: "2026-08-14T09:00:02.000Z",
      kind: "tool-result",
      toolCallId: "c1",
      toolName: "bash",
      text: "24 passed",
      failed: false,
    },
    {
      id: "e3",
      time: "2026-08-14T09:00:03.000Z",
      kind: "message",
      role: "agent",
      content: [{ kind: "text", text: "all green, nothing broke" }],
    },
  ],
  stats: { totalTokens: 1200, costTotal: 0.04, messageCount: 3 },
};

/**
 * Каталоги приезжают снимком вкладов, как в живом окне: воркер объявляет их
 * `contribute.localeCatalog`, а панель ничего не импортирует и за языком никуда не ходит.
 */
const catalogs = [
  {
    ownership: "plugin",
    kind: "locale-catalog",
    id: "subagents.messages-en",
    declaredId: "messages-en",
    pluginKey: "builtin:subagents",
    pluginId: "subagents",
    source: "builtin",
    namespace: messagesNamespace,
    locale: "en",
    messages: englishMessages,
  },
  {
    ownership: "plugin",
    kind: "locale-catalog",
    id: "subagents.messages-ru",
    declaredId: "messages-ru",
    pluginKey: "builtin:subagents",
    pluginId: "subagents",
    source: "builtin",
    namespace: messagesNamespace,
    locale: "ru",
    messages: russianMessages,
  },
] as const;

/** Панель живёт внутри рантайма браузерного SDK: язык окна она берёт у него. */
function renderPanel(context: PlaceContext) {
  const cache = {
    load: () => ({ kind: "loading" as const }),
    peek: () => undefined,
    version: () => 0,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };

  return render(
    <BrowserRuntimeProvider
      contributions={catalogs}
      plugins={[]}
      onDiagnostic={() => {}}
      events={{ subscribe: () => () => {} }}
      locale="ru"
      cache={cache}
      createCache={() => cache}
    >
      <SubagentsPanel context={context} />
    </BrowserRuntimeProvider>,
  );
}

/** Ответы своих маршрутов: панель ходит только по HTTP, второго канала у неё нет. */
function answer(bodies: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((address: string) => {
      const key = Object.keys(bodies).find((one) => address.startsWith(one));

      return Promise.resolve({
        ok: key !== undefined,
        status: key === undefined ? 404 : 200,
        json: () => Promise.resolve(key === undefined ? {} : bodies[key]),
      } as Response);
    }),
  );
}

beforeEach(() => {
  answer({
    "/api/p/subagents/list": { subagents: [listed()] },
    "/api/p/subagents/detail/": detail,
  });
});

it("shows a subagent with its model and an excerpt of its answer", async () => {
  renderPanel({ subject: { page: "session", sessionId: "s-parent" } });

  expect(await screen.findByText("check the tests")).toBeDefined();
  expect(screen.getByText("anthropic/claude-opus-4-5")).toBeDefined();
  expect(screen.getByText("all green, nothing broke")).toBeDefined();
  // Состояние названо текстом, а не только цветом, и переведено на локаль платформы.
  expect(screen.getByRole("status", { name: "Закончил" })).toBeDefined();
});

it("narrows to the open session and asks its own route for exactly that parent", async () => {
  renderPanel({ subject: { page: "session", sessionId: "s-parent" } });

  await screen.findByText("check the tests");

  const asked = vi.mocked(fetch).mock.calls.map(([address]) => String(address));

  expect(asked).toContain("/api/p/subagents/list?parent=s-parent");
  // Переключатель есть только там, где есть сессия: на странице без неё сужать нечего.
  expect(screen.getByRole("radio", { name: "Эта сессия" })).toBeDefined();
});

it("asks for every subagent on a page that has no open session", async () => {
  renderPanel({ subject: { page: "home" } });

  await screen.findByText("check the tests");

  expect(vi.mocked(fetch).mock.calls.map(([address]) => String(address))).toContain(
    "/api/p/subagents/list",
  );
  expect(screen.queryByRole("radio", { name: "Эта сессия" })).toBeNull();
});

it("opens the work of a subagent on click, with its spend and its tool calls", async () => {
  renderPanel({ subject: { page: "session", sessionId: "s-parent" } });

  fireEvent.click(await screen.findByRole("button", { name: /check the tests/u }));

  await waitFor(() => expect(screen.getByRole("log", { name: "Работа субагента" })).toBeDefined());
  expect(screen.getByText("1 200 токенов, 0.04")).toBeDefined();
  expect(screen.getByText("bash")).toBeDefined();
});

it("says so instead of showing an empty list when nobody started a subagent", async () => {
  answer({
    "/api/p/subagents/list": { subagents: [] },
  });

  renderPanel({ subject: { page: "home" } });

  expect(await screen.findByText("Субагентов ещё не запускали.")).toBeDefined();
});
