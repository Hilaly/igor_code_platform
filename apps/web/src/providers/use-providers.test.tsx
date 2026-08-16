// @vitest-environment jsdom

/**
 * Связь вью провайдеров с демоном на настоящем React: правила применения проверены отдельно
 * (`state.test.ts`, `login-state.test.ts`), а здесь — проводка, которой у правил нет.
 *
 * Главное тут восстановление диалога: кадр шага мог уехать в разрыв, и на каждом подъёме соединения
 * идущие попытки перечитываются заново (docs/web-api.md). Проверить это правилом нельзя — правило не
 * знает, кто и когда его позовёт.
 */

import {
  coreEventTypes,
  loginStepFrameKind,
  providerCredentialPath,
  providerLoginAnswerPath,
  providerLoginsPath,
  providersPath,
  userProvidersPath,
  type LoginAttemptState,
  type LoginAttemptsSnapshot,
  type LoginStepFrame,
  type ProviderSummary,
  type ProvidersSnapshot,
} from "@sovereign/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { useProviders } from "./use-providers.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const provider: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [{ type: "oauth", label: "Sign in" }],
  auth: { kind: "unconfigured" },
  keys: [],
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 2,
};

const attempt = (overrides: Partial<LoginAttemptState> = {}): LoginAttemptState => ({
  attemptId: "a1b2",
  providerId: "anthropic",
  method: "oauth",
  origin: "session",
  answerable: true,
  notices: [],
  startedAt: "2026-07-29T09:11:04.512Z",
  ...overrides,
});

type Call = { url: string; method: string; body?: string };

let calls: Call[] = [];
let providers: ProvidersSnapshot = { providers: [provider] };
let running: LoginAttemptsSnapshot = { attempts: [] };
let userProviders = { providers: [] };
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
  providers = { providers: [provider] };
  running = { attempts: [] };
  userProviders = { providers: [] };
  refusals = {};

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    calls.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });

    const refusal = refusals[`${method} ${url}`];

    if (refusal !== undefined) {
      return answer(refusal.body, refusal.status);
    }

    if (url === providersPath) {
      return answer(providers);
    }

    if (url === userProvidersPath) return answer(userProviders);

    if (url === providerLoginsPath && method === "GET") {
      return answer(running);
    }

    return answer({});
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
  // Получатель диагностики один и тот же на всё время жизни: хук пересобирает свои запросы вслед за
  // ним, и новая функция на каждый рендер означала бы перезапрос на каждый ответ.
  const record = (diagnostic: string): void => {
    diagnostics.push(diagnostic);
  };
  const view = renderHook(
    (props: { stream: StreamStatus }) =>
      useProviders({ bus, stream: props.stream, onDiagnostic: record }),
    { initialProps: { stream: status } },
  );

  return { ...view, bus, diagnostics };
}

const asked = (url: string, method = "GET"): Call[] =>
  calls.filter((call) => call.url === url && call.method === method);

describe("useProviders", () => {
  it("asks for the providers and for the running logins as soon as the stream is up", async () => {
    const view = connect("connecting");

    expect(calls).toEqual([]);

    view.rerender({ stream: "open" });

    await waitFor(() => expect(view.result.current.state.snapshot?.providers).toHaveLength(1));
    expect(asked(providerLoginsPath)).toHaveLength(1);
  });

  it("restores the dialog from the snapshot after a reconnection", async () => {
    // Кадр с вопросом уехал в разрыв: окно догона его не спасает, а снимок — да (docs/web-api.md).
    const view = connect();

    await waitFor(() => expect(asked(providerLoginsPath)).toHaveLength(1));
    expect(view.result.current.state.logins.dialogs["anthropic"]).toBeUndefined();

    running = {
      attempts: [
        attempt({
          notices: [{ kind: "progress", message: "ждём" }],
          pending: { stepId: "a1b2-1", kind: "secret", message: "Ключ API" },
        }),
      ],
    };

    view.rerender({ stream: "reconnecting" });
    view.rerender({ stream: "open" });

    await waitFor(() =>
      expect(view.result.current.state.logins.dialogs["anthropic"]?.attempt.pending?.stepId).toBe(
        "a1b2-1",
      ),
    );
    expect(view.result.current.state.logins.dialogs["anthropic"]?.attempt.notices).toHaveLength(1);
    expect(asked(providerLoginsPath)).toHaveLength(2);
  });

  it("carries a step of the stream into the dialog it belongs to", async () => {
    running = { attempts: [attempt()] };

    const view = connect();

    await waitFor(() =>
      expect(view.result.current.state.logins.dialogs["anthropic"]).toBeDefined(),
    );

    const frame: LoginStepFrame = {
      index: 7,
      time: "2026-07-29T09:11:05.000Z",
      frame: loginStepFrameKind,
      attemptId: "a1b2",
      providerId: "anthropic",
      step: { kind: "prompt", prompt: { stepId: "a1b2-1", kind: "text", message: "Организация" } },
    };

    act(() => view.result.current.receiveLoginStep(frame));

    expect(view.result.current.state.logins.dialogs["anthropic"]?.attempt.pending?.message).toBe(
      "Организация",
    );
  });

  it("asks for the running logins when a step arrives for an attempt it knows nothing about", async () => {
    // Вход начали в другой вкладке той же сессии: собирать попытку из одного кадра нечем.
    const view = connect();

    await waitFor(() => expect(asked(providerLoginsPath)).toHaveLength(1));

    act(() =>
      view.result.current.receiveLoginStep({
        index: 7,
        time: "2026-07-29T09:11:05.000Z",
        frame: loginStepFrameKind,
        attemptId: "zzz",
        providerId: "anthropic",
        step: { kind: "notice", notice: { kind: "progress", message: "идёт" } },
      }),
    );

    await waitFor(() => expect(asked(providerLoginsPath)).toHaveLength(2));
  });

  it("asks for the providers again on a login and on a logout of somebody else", async () => {
    const view = connect();

    await waitFor(() => expect(asked(providersPath)).toHaveLength(1));

    act(() =>
      view.bus.publish({
        index: 8,
        time: "2026-07-29T09:11:06.000Z",
        type: coreEventTypes.providerLogin,
        payload: { providerId: "anthropic", method: "oauth" },
      }),
    );

    await waitFor(() => expect(asked(providersPath)).toHaveLength(2));
  });

  it("sends the answer to the step the dialog is on and takes the question away", async () => {
    running = {
      attempts: [attempt({ pending: { stepId: "a1b2-1", kind: "secret", message: "Ключ API" } })],
    };

    const view = connect();

    await waitFor(() =>
      expect(view.result.current.state.logins.dialogs["anthropic"]).toBeDefined(),
    );

    act(() => view.result.current.answer("anthropic", "a1b2-1", "sk-ant-secret"));

    await waitFor(() =>
      expect(
        view.result.current.state.logins.dialogs["anthropic"]?.attempt.pending,
      ).toBeUndefined(),
    );

    const sent = asked(providerLoginAnswerPath("a1b2"), "POST");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBe('{"stepId":"a1b2-1","value":"sk-ant-secret"}');
    // Значение уехало телом запроса и нигде не осело: в состоянии его нет.
    expect(JSON.stringify(view.result.current.state)).not.toContain("sk-ant-secret");
  });

  it("says a step that no longer waits instead of keeping quiet about it", async () => {
    running = {
      attempts: [attempt({ pending: { stepId: "a1b2-1", kind: "text", message: "Организация" } })],
    };
    refusals[`POST ${providerLoginAnswerPath("a1b2")}`] = {
      status: 409,
      body: { error: "that login step is no longer waiting for an answer" },
    };

    const view = connect();

    await waitFor(() =>
      expect(view.result.current.state.logins.dialogs["anthropic"]).toBeDefined(),
    );

    act(() => view.result.current.answer("anthropic", "a1b2-1", "acme"));

    await waitFor(() =>
      expect(view.result.current.state.logins.dialogs["anthropic"]?.refusal).toBe(
        "that login step is no longer waiting for an answer",
      ),
    );
  });

  it("keeps the running attempt of a refused start: the human has to see what took the provider", async () => {
    refusals[`POST ${providerLoginsPath}`] = {
      status: 409,
      body: {
        error: "a login into anthropic is already running",
        conflict: attempt({ origin: "plugin", answerable: false }),
      },
    };

    const view = connect();

    await waitFor(() => expect(asked(providersPath)).toHaveLength(1));

    act(() => view.result.current.logIn("anthropic", "oauth"));

    await waitFor(() =>
      expect(view.result.current.state.logins.dialogs["anthropic"]?.taken).toBe(true),
    );
    expect(view.result.current.state.logins.dialogs["anthropic"]?.attempt.origin).toBe("plugin");
  });

  it("says the logout changed nothing when the credential came from the environment", async () => {
    // Ответ маршрута — нынешний статус провайдера, и он единственный способ узнать это
    // (docs/web-api.md).
    refusals[`DELETE ${providerCredentialPath("anthropic")}`] = {
      status: 200,
      body: {
        ...provider,
        auth: { kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" },
      },
    };

    const view = connect();

    await waitFor(() => expect(asked(providersPath)).toHaveLength(1));

    act(() => view.result.current.logOut("anthropic"));

    await waitFor(() =>
      expect(view.result.current.state.logins.stubborn["anthropic"]).toEqual({
        source: "ANTHROPIC_API_KEY",
      }),
    );
  });
});
