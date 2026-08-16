import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BrowserRuntimeProvider } from "@sovereign/browser-sdk/host";
import type {
  BrowserEvent,
  BrowserEventBridge,
  BrowserEventListener,
  BrowserRecoveryListener,
} from "@sovereign/browser-sdk";
import { MissionPanel } from "./mission-panel.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function event(type: string, payload: unknown = {}): BrowserEvent {
  return {
    type,
    index: 2,
    time: "2026-08-16T12:30:00.000Z",
    payload,
  } as BrowserEvent;
}

function snapshot(mission: string, revision: number, updatedAt = "2026-08-16T12:30:00.000Z") {
  return {
    mission,
    plan: [{ step: "Test", status: "completed" as const }],
    revision,
    updatedAt,
  };
}

const planned = {
  mission: "Ship the panel",
  explanation: "Context gathered",
  plan: [
    { step: "Read the code", status: "completed" as const },
    { step: "Redraw the panel", status: "in_progress" as const },
    { step: "Check by running", status: "pending" as const },
  ],
  revision: 1,
  updatedAt: "2026-08-16T12:30:00.000Z",
};

function response(value: ReturnType<typeof snapshot> | typeof planned): Response {
  return { ok: true, status: 200, json: async () => value } as Response;
}

/** Язык окна. Своей настройки языка у плагина нет: он спрашивает её у платформы. */
let windowLocale = "en";

afterEach(() => {
  windowLocale = "en";
});

type MissionAnswer = Response | (() => Promise<Response>);

/**
 * Панель ходит по двум адресам: за миссией и за локалью окна. Считать надо только первые — иначе
 * тест перезагрузок меряет ещё и однократный запрос настроек, к миссии отношения не имеющий.
 * Последний ответ повторяется: так же вела себя прежняя `mockResolvedValue`.
 */
function missionFetch(...answers: MissionAnswer[]) {
  let taken = 0;

  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (String(input).startsWith("/api/preferences")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ locale: windowLocale }),
      } as Response);
    }

    const answer = answers[Math.min(taken, answers.length - 1)];
    taken += 1;

    return typeof answer === "function" ? answer() : Promise.resolve(answer as Response);
  });
}

function missionCalls(mock: ReturnType<typeof missionFetch>): number {
  return mock.mock.calls.filter(([input]) => String(input).startsWith("/api/p/mission")).length;
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
    listenerCounts: () => [eventListeners.size, recoveryListeners.size],
  };
}

function renderPanel(events: BrowserEventBridge, sessionId = "s1") {
  const cache = {
    load: () => ({ kind: "loading" as const }),
    peek: () => undefined,
    version: () => 0,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
  const view = render(
    <BrowserRuntimeProvider
      contributions={[]}
      plugins={[]}
      onDiagnostic={() => {}}
      events={events}
      cache={cache}
      createCache={() => cache}
    >
      <MissionPanel context={{ subject: { sessionId } }} />
    </BrowserRuntimeProvider>,
  );
  return {
    ...view,
    rerenderSession(nextSessionId: string) {
      view.rerender(
        <BrowserRuntimeProvider
          contributions={[]}
          plugins={[]}
          onDiagnostic={() => {}}
          events={events}
          cache={cache}
          createCache={() => cache}
        >
          <MissionPanel context={{ subject: { sessionId: nextSessionId } }} />
        </BrowserRuntimeProvider>,
      );
    },
  };
}

it("reloads for matching mission events, stream gaps, and stream recovery", async () => {
  const channel = bridge();
  const fetchMock = missionFetch(response(snapshot("Ship", 3)));
  renderPanel(channel.events);
  await screen.findByText("Ship");

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "other", revision: 4 })),
  );
  expect(missionCalls(fetchMock)).toBe(1);

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "s1", revision: 4 })),
  );
  await act(async () => channel.publish(event("core.stream.gap")));
  await act(async () => channel.recover());

  expect(missionCalls(fetchMock)).toBe(4);
});

it("keeps the revision announced by an event as the required response floor", async () => {
  const channel = bridge();
  const fetchMock = missionFetch(
    response(snapshot("Revision one", 1)),
    response(snapshot("Still revision one", 1)),
    response(snapshot("Revision two", 2)),
  );
  renderPanel(channel.events);
  await screen.findByText("Revision one");

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "s1", revision: 2 })),
  );
  expect(screen.queryByText("Still revision one")).toBeNull();
  expect(screen.getByText("Revision one")).not.toBeNull();

  await act(async () => channel.recover());
  await screen.findByText("Revision two");
  expect(missionCalls(fetchMock)).toBe(3);
});

it("clears the old session immediately and ignores its late response", async () => {
  const channel = bridge();
  let resolveSecond: ((value: Response) => void) | undefined;
  const fetchMock = missionFetch(
    response(snapshot("Session one", 1)),
    () => new Promise((resolve) => (resolveSecond = resolve)),
  );
  const view = renderPanel(channel.events);
  await screen.findByText("Session one");

  view.rerenderSession("s2");
  expect(screen.queryByText("Session one")).toBeNull();
  expect(screen.getByText("Loading mission")).not.toBeNull();

  await act(async () =>
    channel.publish(event("mission.changed", { sessionId: "s1", revision: 9 })),
  );
  expect(missionCalls(fetchMock)).toBe(2);
  await act(async () => resolveSecond?.(response(snapshot("Session two", 1))));
  await screen.findByText("Session two");
});

/**
 * Три яруса вместо ровного столбца абзацев: задание, пояснение и план. Состояние каждого шага
 * названо словом — цвет точки его дублирует, но не заменяет.
 */
it("separates the mission, its explanation, and the named state of every step", async () => {
  const channel = bridge();
  missionFetch(response(planned));
  renderPanel(channel.events);

  await screen.findByText("Ship the panel");
  expect(screen.getByText("Context gathered")).not.toBeNull();

  // Счётчик подписывает полосу: без него доля выполненного нигде не названа.
  expect(screen.getByText("Steps")).not.toBeNull();
  expect(screen.getByText("1 of 3")).not.toBeNull();
  expect(
    screen.getByRole("progressbar", { name: "Mission progress" }).getAttribute("aria-valuenow"),
  ).toBe("33");

  expect(screen.getByRole("status", { name: "Done" })).not.toBeNull();
  expect(screen.getByRole("status", { name: "In progress" })).not.toBeNull();
  expect(screen.getByRole("status", { name: "Not started" })).not.toBeNull();

  // Сырое машинное значение статуса в панель больше не попадает.
  expect(screen.queryByText("in progress")).toBeNull();
});

/**
 * Панель говорит на языке окна, а не на своём. Раньше все её строки были зашиты по-английски, а
 * состояния шагов выводились сырыми машинными значениями.
 */
it("speaks the language of the window", async () => {
  windowLocale = "ru";
  const channel = bridge();
  missionFetch(response(planned));
  renderPanel(channel.events);

  await screen.findByRole("heading", { name: "Миссия" });
  expect(screen.getByText("Шаги")).not.toBeNull();
  expect(screen.getByText("1 из 3")).not.toBeNull();
  expect(screen.getByRole("status", { name: "В работе" })).not.toBeNull();
  expect(screen.getByText(/Обновлено/u)).not.toBeNull();
});

it("shows updated time and unsubscribes from events and recovery", async () => {
  const channel = bridge();
  missionFetch(response(snapshot("Ship", 1)));
  const view = renderPanel(channel.events);

  await screen.findByText("Ship");
  expect(screen.getByText(/Updated.*2026/u)).not.toBeNull();
  expect(channel.listenerCounts()).toEqual([1, 1]);

  view.unmount();
  await waitFor(() => expect(channel.listenerCounts()).toEqual([0, 0]));
});
