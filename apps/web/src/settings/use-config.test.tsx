// @vitest-environment jsdom

/**
 * Связь формы конфига с демоном на настоящем React: правила черновика проверены отдельно
 * (`config-draft.test.ts`), здесь — проводка, которой у правил нет.
 *
 * Главное тут перезапрос по `core.config.changed`: файл правят и руками, и из формы, а форма обязана
 * узнать об этом на живом демоне (docs/data-directory.md).
 */

import {
  configPath,
  coreEventTypes,
  defaultConfig,
  streamGapType,
  type BusStreamEvent,
} from "@sovereign/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { useConfig } from "./use-config.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Call = { method: string; body?: string };

let calls: Call[] = [];
let stored = defaultConfig;
/** Ответ на запись: код и тело подставляет тест. */
let refusal: { status: number; body: unknown } | undefined;

const answer = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);

beforeEach(() => {
  calls = [];
  stored = defaultConfig;
  refusal = undefined;

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    if (url !== configPath) {
      throw new Error(`unexpected request to ${url}`);
    }

    calls.push({ method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });

    if (method === "GET") {
      return answer(stored);
    }

    if (refusal !== undefined) {
      return answer(refusal.body, refusal.status);
    }

    stored = { ...stored, ...(JSON.parse(init?.body as string) as Partial<typeof defaultConfig>) };

    return answer(stored);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function connect(status: StreamStatus = "open") {
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
    (props: { stream: StreamStatus }) =>
      useConfig({ bus, stream: props.stream, onDiagnostic: record }),
    { initialProps: { stream: status } },
  );

  return { ...view, bus, diagnostics };
}

const asked = (method = "GET"): Call[] => calls.filter((call) => call.method === method);

/** Кадры событий, у которых нагрузки нет: состояние спрашивается у владельца (docs/event-bus.md). */
const configChanged: BusStreamEvent = {
  index: 8,
  time: "2026-08-07T09:11:06.000Z",
  type: coreEventTypes.configChanged,
  payload: {},
};

const preferencesChanged: BusStreamEvent = {
  index: 8,
  time: "2026-08-07T09:11:06.000Z",
  type: coreEventTypes.preferencesChanged,
  payload: {},
};

const gap: BusStreamEvent = {
  index: 9,
  time: "2026-08-07T09:11:07.000Z",
  type: streamGapType,
  payload: { requestedIndex: 2, oldestIndex: 8 },
};

describe("useConfig", () => {
  it("asks for the config as soon as the stream is up", async () => {
    const view = connect("connecting");

    expect(calls).toEqual([]);

    view.rerender({ stream: "open" });

    await waitFor(() => expect(view.result.current.state.config).toEqual(defaultConfig));
  });

  it("asks again when somebody changed the file", async () => {
    const view = connect();

    await waitFor(() => expect(asked()).toHaveLength(1));

    stored = { ...defaultConfig, maxConcurrentTurns: 9 };
    act(() => view.bus.publish(configChanged));

    await waitFor(() => expect(view.result.current.state.config?.maxConcurrentTurns).toBe(9));
  });

  it("asks again after a gap in the stream", async () => {
    const view = connect();

    await waitFor(() => expect(asked()).toHaveLength(1));

    act(() => view.bus.publish(gap));

    await waitFor(() => expect(asked()).toHaveLength(2));
  });

  it("stays quiet on events that are not about the config", async () => {
    const view = connect();

    await waitFor(() => expect(asked()).toHaveLength(1));

    act(() => view.bus.publish(preferencesChanged));

    expect(asked()).toHaveLength(1);
  });

  it("writes one changed key and keeps the complete daemon answer", async () => {
    const view = connect();

    await waitFor(() => expect(view.result.current.state.config).toEqual(defaultConfig));

    act(() => view.result.current.update("maxConcurrentTurns", 8));

    await waitFor(() => expect(view.result.current.state.config?.maxConcurrentTurns).toBe(8));
    expect(JSON.parse(asked("PUT")[0]?.body ?? "{}")).toEqual({
      maxConcurrentTurns: 8,
    });
  });

  it("shows the refusal and asks for the file again", async () => {
    const view = connect();

    await waitFor(() => expect(view.result.current.state.config).toEqual(defaultConfig));

    refusal = { status: 409, body: { error: "config.json: EACCES" } };
    act(() => view.result.current.update("maxConcurrentTurns", 8));

    await waitFor(() => expect(view.result.current.state.refusal).toBe("config.json: EACCES"));
    // Снимок перезапрашивается: отказ как раз о том, что файл живёт своей жизнью.
    await waitFor(() => expect(asked()).toHaveLength(2));
    expect(view.result.current.state.config?.maxConcurrentTurns).toBe(4);
    expect(view.diagnostics).toEqual(["the daemon config was not written: config.json: EACCES"]);
  });

  it("takes the answer to the last write and drops the stale one", async () => {
    const view = connect();

    await waitFor(() => expect(view.result.current.state.config).toEqual(defaultConfig));

    const answers: ((config: unknown) => void)[] = [];

    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return answer(stored);
      }

      return new Promise<Response>((resolve) => {
        answers.push((config) =>
          resolve({ ok: true, status: 200, json: () => Promise.resolve(config) } as Response),
        );
      });
    });

    act(() => view.result.current.update("maxConcurrentTurns", 8));
    act(() => view.result.current.update("maxConcurrentTurns", 2));

    await waitFor(() => expect(answers).toHaveLength(2));

    // Ответ на вторую запись приходит первым, на первую — последним: применяется последняя запись.
    act(() => answers[1]?.({ ...defaultConfig, maxConcurrentTurns: 2 }));
    act(() => answers[0]?.({ ...defaultConfig, maxConcurrentTurns: 8 }));

    await waitFor(() => expect(view.result.current.state.config?.maxConcurrentTurns).toBe(2));
  });
});
