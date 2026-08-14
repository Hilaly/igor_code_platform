import type { Session, SessionsSnapshot, SessionStats } from "@sovereign/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchUsage } from "./usage-api.ts";

const session = (id: string, archived = false): Session => ({
  id,
  projectId: "project-alpha",
  folder: "/workspace/alpha",
  agentId: "default",
  agentAvailable: true,
  model: "provider/model",
  thinkingLevel: "medium",
  phase: "idle",
  archived,
  hidden: false,
  createdAt: "2026-08-08T12:00:00.000Z",
});

const stats = (sessionId: string): SessionStats => ({
  sessionId,
  messageCount: 2,
  cachedTokens: 30,
  uncachedTokens: 70,
  totalTokens: 100,
  costTotal: 0.25,
});

const json = (body: SessionsSnapshot | SessionStats, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("fetchUsage", () => {
  it("loads active and archived catalogs and exact stats for every unique session", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/sessions") return json({ sessions: [session("active")] });
      if (path === "/api/sessions?archived=true") {
        return json({ sessions: [session("archived", true), session("active")] });
      }
      if (path === "/api/sessions/active/stats") return json(stats("active"));
      if (path === "/api/sessions/archived/stats") return json(stats("archived"));
      throw new Error(`unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsage();

    expect(result.catalogComplete).toBe(true);
    expect(result.listedSessionCount).toBe(2);
    expect(result.records.map(({ session: value }) => value.id)).toEqual(["active", "archived"]);
    expect(result.problems).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns exact successful rows and names every unreadable or disappeared statistic", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        if (path === "/api/sessions") {
          return json({ sessions: [session("ready"), session("broken")], problems: ["bad file"] });
        }
        if (path === "/api/sessions?archived=true")
          return json({ sessions: [session("gone", true)], problems: ["bad file"] });
        if (path === "/api/sessions/ready/stats") return json(stats("ready"));
        if (path === "/api/sessions/broken/stats") {
          return new Response(JSON.stringify({ error: "cannot read stats" }), { status: 500 });
        }
        if (path === "/api/sessions/gone/stats") return new Response(null, { status: 404 });
        throw new Error(`unexpected request: ${path}`);
      }),
    );

    const result = await fetchUsage();

    expect(result.catalogComplete).toBe(false);
    expect(result.records.map(({ session: value }) => value.id)).toEqual(["ready"]);
    expect(result.listedSessionCount).toBe(3);
    expect(result.problems).toEqual([
      "bad file",
      "broken: cannot read stats",
      "gone: statistics are no longer available",
    ]);
  });

  it("keeps an exact archived result when the active catalog fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        if (path === "/api/sessions") throw new Error("active catalog unavailable");
        if (path === "/api/sessions?archived=true") {
          return json({ sessions: [session("archived", true)] });
        }
        if (path === "/api/sessions/archived/stats") return json(stats("archived"));
        throw new Error(`unexpected request: ${path}`);
      }),
    );

    await expect(fetchUsage()).resolves.toEqual({
      catalogComplete: false,
      listedSessionCount: 1,
      records: [{ session: session("archived", true), stats: stats("archived") }],
      problems: ["active sessions: active catalog unavailable"],
    });
  });

  it("fails the screen when neither session catalog can be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    await expect(fetchUsage()).rejects.toThrow(
      "active sessions: connection refused; archived sessions: connection refused",
    );
  });

  it("limits simultaneous exact stats reads", async () => {
    const sessions = Array.from({ length: 8 }, (_, index) => session(`session-${String(index)}`));
    let activeStatsReads = 0;
    let maximumStatsReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        if (path === "/api/sessions") return json({ sessions });
        if (path === "/api/sessions?archived=true") return json({ sessions: [] });
        const match = /^\/api\/sessions\/(session-\d+)\/stats$/.exec(path);
        if (match?.[1] === undefined) throw new Error(`unexpected request: ${path}`);

        activeStatsReads += 1;
        maximumStatsReads = Math.max(maximumStatsReads, activeStatsReads);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeStatsReads -= 1;
        return json(stats(match[1]));
      }),
    );

    const result = await fetchUsage();

    expect(result.records).toHaveLength(8);
    expect(maximumStatsReads).toBeLessThanOrEqual(6);
  });
});
