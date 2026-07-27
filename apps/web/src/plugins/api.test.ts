import { pluginPreferencesPath, pluginsPath } from "@sovereign/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPluginsSnapshot, writePluginPreferences } from "./api.ts";

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

describe("fetchPluginsSnapshot", () => {
  it("asks the plugins route and gives back the snapshot", async () => {
    const calls = daemon({ status: 200, body: { revision: 3 } });

    await expect(fetchPluginsSnapshot()).resolves.toEqual({ revision: 3 });
    expect(calls[0]?.url).toBe(pluginsPath);
  });

  it("names the code when the daemon refuses", async () => {
    daemon({ status: 500, body: {} });

    await expect(fetchPluginsSnapshot()).rejects.toThrow("the daemon answered 500");
  });
});

describe("writePluginPreferences", () => {
  it("puts the whole record to the route of the plugin", async () => {
    const preferences = { enabled: true, disabledContributions: ["hello.panel"] };
    const calls = daemon({ status: 200, body: { key: "data:hello", preferences } });

    await expect(writePluginPreferences("data:hello", preferences)).resolves.toEqual({
      key: "data:hello",
      preferences,
    });
    // Ключ содержит двоеточие, и в пути оно обязано быть закодировано.
    expect(calls[0]?.url).toBe(pluginPreferencesPath("data:hello"));
    expect(calls[0]?.init?.body).toBe(JSON.stringify(preferences));
  });

  it("carries the reason of a refused write, not the code alone", async () => {
    // `409` означает, что файл на диске правил кто-то ещё: разобраться с этим может только человек.
    daemon({ status: 409, body: { error: "preferences.json is not readable" } });

    await expect(
      writePluginPreferences("data:hello", { enabled: false, disabledContributions: [] }),
    ).rejects.toThrow("preferences.json is not readable");
  });
});
