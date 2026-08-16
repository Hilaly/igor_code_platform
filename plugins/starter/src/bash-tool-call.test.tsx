import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BrowserRuntimeProvider } from "@sovereign/browser-sdk/host";
import type {
  BrowserEvent,
  BrowserEventBridge,
  BrowserEventListener,
  BrowserRecoveryListener,
} from "@sovereign/browser-sdk";
import type { SessionEntriesPage, SessionEntry } from "@sovereign/sdk";

import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import { BashToolCall } from "./bash-tool-call.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function event(type: string, payload: unknown = {}): BrowserEvent {
  return { type, index: 2, time: "2026-08-16T12:30:00.000Z", payload } as BrowserEvent;
}

function bridge() {
  const eventListeners = new Set<BrowserEventListener>();
  const recoveryListeners = new Set<BrowserRecoveryListener>();
  const events: BrowserEventBridge = {
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeRecovery(listener) {
      recoveryListeners.add(listener);
      return () => recoveryListeners.delete(listener);
    },
  };
  return {
    events,
    publish(next: BrowserEvent) {
      for (const listener of eventListeners) listener(next);
    },
    recover() {
      for (const listener of recoveryListeners) listener();
    },
  };
}

function callEntry(toolCallId: string, toolName: string, input: unknown): SessionEntry {
  return {
    id: `m-${toolCallId}`,
    time: "2026-08-16T12:30:00.000Z",
    kind: "message",
    role: "agent",
    content: [{ kind: "tool-call", toolCallId, toolName, input }],
  };
}

function resultEntry(toolCallId: string, text: string, failed: boolean): SessionEntry {
  return {
    id: `r-${toolCallId}`,
    time: "2026-08-16T12:30:01.000Z",
    kind: "tool-result",
    toolCallId,
    toolName: "bash",
    text,
    failed,
  };
}

function page(entries: SessionEntry[]): SessionEntriesPage {
  return { sessionId: "s1", entries, seen: entries.length };
}

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** Язык окна. Своей настройки языка у плагина нет: её задаёт рантайм браузерного SDK. */
let windowLocale = "ru";

afterEach(() => {
  windowLocale = "ru";
});

/**
 * Каталоги приезжают снимком вкладов — ровно как в живом окне: воркер объявляет их
 * `contribute.localeCatalog`, а компонент ничего не импортирует и ничего не спрашивает.
 */
const catalogs = [
  {
    ownership: "plugin",
    kind: "locale-catalog",
    id: "starter.bash-messages-en",
    declaredId: "bash-messages-en",
    pluginKey: "builtin:starter",
    pluginId: "starter",
    source: "builtin",
    namespace: messagesNamespace,
    locale: "en",
    messages: englishMessages,
  },
  {
    ownership: "plugin",
    kind: "locale-catalog",
    id: "starter.bash-messages-ru",
    declaredId: "bash-messages-ru",
    pluginKey: "builtin:starter",
    pluginId: "starter",
    source: "builtin",
    namespace: messagesNamespace,
    locale: "ru",
    messages: russianMessages,
  },
] as const;

/** Мок fetch: записи сессии, всё остальное — 404. Локаль плагин не спрашивает: её даёт рантайм. */
function installFetch(entries: SessionEntry[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sessions/s1/entries") return response(page(entries));
    return { ok: false, status: 404 } as Response;
  });
}

function renderCard(channel: ReturnType<typeof bridge>, toolName = "bash", toolCallId = "c1") {
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
      locale={windowLocale}
      events={channel.events}
      cache={cache}
      createCache={() => cache}
    >
      <BashToolCall context={{ subject: { sessionId: "s1", toolCallId, toolName } }} />
    </BrowserRuntimeProvider>,
  );
}

function expand(title: string): Promise<void> {
  return act(async () => {
    (screen.getByText(title).closest("summary") as HTMLElement).click();
  });
}

it("shows the command and a running badge while the call has no result yet", async () => {
  installFetch([callEntry("c1", "bash", { command: "pnpm test" })]);
  renderCard(bridge());
  expect(await screen.findByText("pnpm test")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("shows a compact card while the call is not in the records yet", async () => {
  installFetch([]);
  renderCard(bridge());
  expect(await screen.findByText("bash")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("is collapsed by default and shows output, stderr and the exit badge when expanded", async () => {
  installFetch([
    callEntry("c1", "bash", { command: "pnpm test" }),
    resultEntry("c1", "ok\n[stderr]\nwarn", false),
  ]);
  renderCard(bridge());
  await screen.findByText("pnpm test");
  // Свёрнуто по умолчанию: зажат нативный <details> без `open` (ui-kit Disclosure). Содержимое
  // нативного <details> остаётся в DOM и в свёрнутом виде, поэтому свёрнутость проверяем по атрибуту.
  expect((screen.getByText("pnpm test").closest("details") as HTMLElement)?.hasAttribute("open")).toBe(false);
  await expand("pnpm test");
  // Раскрытие нативного <details> атрибутом `open`, а не появлением текста: содержимое нативного
  // <details> остаётся в DOM и в свёрнутом виде, поэтому наличие текста раскрытие не доказывает.
  expect((screen.getByText("pnpm test").closest("details") as HTMLElement)?.hasAttribute("open")).toBe(true);
  expect(await screen.findByText("ok")).toBeTruthy();
  expect(screen.getByText("warn")).toBeTruthy();
  expect(screen.getByText("exit 0")).toBeTruthy();
  expect(screen.getByText("Готово")).toBeTruthy();
});

it("shows the failed state with the whole result in the stderr section", async () => {
  installFetch([
    callEntry("c1", "job-kill", { jobId: "j9" }),
    resultEntry("c1", "unknown job j9", true),
  ]);
  renderCard(bridge(), "job-kill", "c1");
  await screen.findByText("job-kill j9");
  await expand("job-kill j9");
  expect(await screen.findByText("unknown job j9")).toBeTruthy();
  expect(screen.getByText("Не удалось")).toBeTruthy();
});

it("reflects the job status from the result text for job-output", async () => {
  installFetch([
    callEntry("c1", "job-output", { jobId: "j9" }),
    resultEntry("c1", "(no new output)\n[status: running]", false),
  ]);
  renderCard(bridge(), "job-output", "c1");
  expect(await screen.findByText("job-output j9")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("shows the background badge for a background job", async () => {
  installFetch([callEntry("c1", "bash", { command: "sleep 60", run_in_background: true })]);
  renderCard(bridge());
  await screen.findByText("sleep 60");
  await expand("sleep 60");
  expect(await screen.findByText("фон")).toBeTruthy();
});

it("reloads the records when the session state changes", async () => {
  const channel = bridge();
  const fetchMock = installFetch([callEntry("c1", "bash", { command: "ls" })]);
  renderCard(channel);
  await screen.findByText("ls");
  fetchMock.mockClear();
  await act(async () => channel.publish(event("core.sessions.changed")));
  expect(fetchMock).toHaveBeenCalled();
});
