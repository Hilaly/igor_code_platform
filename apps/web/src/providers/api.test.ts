import {
  providerCredentialPath,
  providerLoginAnswerPath,
  providerLoginPath,
  providerLoginsPath,
  providerModelsPath,
  providersPath,
  userProviderPath,
  userProviderRefreshPath,
  userProvidersPath,
  type LoginAttemptState,
  type ModelSummary,
  type ProviderSummary,
  type UserProviderDefinition,
} from "@sovereign/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerLoginStep,
  cancelProviderLogin,
  fetchLoginAttempts,
  fetchProviderModels,
  fetchProvidersSnapshot,
  createUserProvider,
  deleteUserProvider,
  fetchUserProvider,
  fetchUserProviders,
  refreshUserProvider,
  updateUserProvider,
  logOutProvider,
  startProviderLogin,
} from "./api.ts";

const userProvider: UserProviderDefinition = {
  id: "vendor",
  name: "Vendor",
  baseUrl: "https://vendor.test/v1",
  api: "openai-responses",
  modelsEndpoint: { kind: "default" },
  modelDefaults: {
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
  },
  manualModels: [],
  modelOverrides: {},
  disabledModelIds: [],
};

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

const model: ModelSummary = {
  id: "claude-opus-4",
  name: "Claude Opus 4",
  providerId: "anthropic",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 15, output: 75 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProvidersSnapshot", () => {
  it("asks the providers route and gives back the snapshot", async () => {
    const body = { providers: [], problem: undefined };
    const calls = daemon({ status: 200, body });

    await expect(fetchProvidersSnapshot()).resolves.toEqual(body);
    expect(calls[0]?.url).toBe(providersPath);
  });

  it("keeps the problem of the snapshot: it is an answer, not a refusal", async () => {
    // Негодный файл кредов отвечает `200` и кладёт беду в тело (docs/web-api.md): список провайдеров
    // от файла не зависит, и пустое вью чинить файл не помогает.
    const body = { providers: [], problem: "credentials.json is not valid json" };

    daemon({ status: 200, body });

    await expect(fetchProvidersSnapshot()).resolves.toEqual(body);
  });

  it("carries the reason of the daemon instead of the bare code", async () => {
    daemon({ status: 401, body: { error: "unauthorized" } });

    await expect(fetchProvidersSnapshot()).rejects.toThrow("unauthorized");
  });

  it("names the code when the answer has no reason in it", async () => {
    daemon({ status: 500, body: {} });

    await expect(fetchProvidersSnapshot()).rejects.toThrow("the daemon answered 500");
  });
});

describe("user provider requests", () => {
  it("uses the dedicated collection and item routes", async () => {
    const details = { definition: userProvider };
    const calls = daemon({ status: 200, body: details });

    await fetchUserProviders();
    await fetchUserProvider("vendor");
    await createUserProvider(userProvider);
    await updateUserProvider("vendor", userProvider);
    await refreshUserProvider("vendor");
    await deleteUserProvider("vendor");

    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      [userProvidersPath, undefined],
      [userProviderPath("vendor"), undefined],
      [userProvidersPath, "POST"],
      [userProviderPath("vendor"), "PUT"],
      [userProviderRefreshPath("vendor"), "POST"],
      [userProviderPath("vendor"), "DELETE"],
    ]);
  });
});

const attempt: LoginAttemptState = {
  attemptId: "a1b2",
  providerId: "anthropic",
  method: "oauth",
  origin: "session",
  answerable: true,
  notices: [],
  startedAt: "2026-07-29T09:11:04.512Z",
};

const summary: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [{ type: "oauth", label: "Sign in" }],
  auth: { kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" },
  keys: [],
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 2,
};

describe("fetchLoginAttempts", () => {
  it("asks the route that holds the running logins", async () => {
    const calls = daemon({ status: 200, body: { attempts: [attempt] } });

    await expect(fetchLoginAttempts()).resolves.toEqual({ attempts: [attempt] });
    expect(calls[0]?.url).toBe(providerLoginsPath);
  });
});

describe("startProviderLogin", () => {
  it("names the provider and the way in", async () => {
    const calls = daemon({ status: 200, body: attempt });

    await expect(startProviderLogin({ providerId: "anthropic", method: "oauth" })).resolves.toEqual(
      { kind: "started", attempt },
    );
    expect(calls[0]?.url).toBe(providerLoginsPath);
    expect(calls[0]?.init?.body).toBe('{"providerId":"anthropic","method":"oauth"}');
  });

  it("gives back the running attempt instead of throwing the conflict away", async () => {
    // Вью обязано показать, чем занят провайдер: по `origin` и `answerable` видно, отвечает ли
    // здесь человек или плагин (docs/web-api.md).
    const busy = { ...attempt, origin: "plugin" as const, answerable: false };

    daemon({ status: 409, body: { error: "a login is already running", conflict: busy } });

    await expect(startProviderLogin({ providerId: "anthropic", method: "oauth" })).resolves.toEqual(
      { kind: "taken", error: "a login is already running", conflict: busy },
    );
  });

  it("carries a refusal that has no conflict in it", async () => {
    // Негодный `credentials.json` — тоже `409`, но занявшей попытки в нём нет (docs/web-api.md).
    daemon({ status: 409, body: { error: "credentials.json is not valid json" } });

    await expect(startProviderLogin({ providerId: "anthropic", method: "oauth" })).rejects.toThrow(
      "credentials.json is not valid json",
    );
  });
});

describe("answerLoginStep", () => {
  it("names the step it answers", async () => {
    const calls = daemon({ status: 200, body: {} });

    await expect(answerLoginStep("a1b2", { stepId: "a1b2-1", value: "sk-ant" })).resolves.toEqual({
      kind: "answered",
    });
    expect(calls[0]?.url).toBe(providerLoginAnswerPath("a1b2"));
    expect(calls[0]?.init?.body).toBe('{"stepId":"a1b2-1","value":"sk-ant"}');
  });

  it("calls a step that no longer waits an outcome, not a failure", async () => {
    daemon({ status: 409, body: { error: "that login step is no longer waiting for an answer" } });

    await expect(answerLoginStep("a1b2", { stepId: "a1b2-1", value: "x" })).resolves.toEqual({
      kind: "stale",
      reason: "that login step is no longer waiting for an answer",
    });
  });

  it("carries a refusal of any other kind", async () => {
    daemon({ status: 404, body: { error: "not found" } });

    await expect(answerLoginStep("a1b2", { stepId: "a1b2-1", value: "x" })).rejects.toThrow(
      "not found",
    );
  });
});

describe("cancelProviderLogin", () => {
  it("deletes the attempt", async () => {
    const calls = daemon({ status: 200, body: {} });

    await cancelProviderLogin("a1b2");

    expect(calls[0]?.url).toBe(providerLoginPath("a1b2"));
    expect(calls[0]?.init?.method).toBe("DELETE");
  });
});

describe("logOutProvider", () => {
  it("gives back the status of the provider, not an empty answer", async () => {
    // Кред из окружения выходом не убрать, и ответ говорит об этом прямо (docs/web-api.md).
    const calls = daemon({ status: 200, body: summary });

    await expect(logOutProvider("anthropic")).resolves.toEqual(summary);
    expect(calls[0]?.url).toBe(providerCredentialPath("anthropic"));
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  it("carries the refusal of a credentials file nobody can read", async () => {
    daemon({ status: 409, body: { error: "credentials.json is not valid json" } });

    await expect(logOutProvider("anthropic")).rejects.toThrow("credentials.json is not valid json");
  });
});

describe("fetchProviderModels", () => {
  it("asks the route of that one provider", async () => {
    const body = { providerId: "anthropic", models: [model] };
    const calls = daemon({ status: 200, body });

    await expect(fetchProviderModels("anthropic")).resolves.toEqual(body);
    expect(calls[0]?.url).toBe(providerModelsPath("anthropic"));
  });

  it("carries the refusal of an unknown provider", async () => {
    daemon({ status: 404, body: { error: "not found" } });

    await expect(fetchProviderModels("nobody")).rejects.toThrow("not found");
  });
});
