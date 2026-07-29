import { providerModelsPath, providersPath, type ModelSummary } from "@sovereign/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProviderModels, fetchProvidersSnapshot } from "./api.ts";

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
