import type { Session, SessionStats } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { initialUsageState, receiveUsage, summarizeUsage, usageFailed } from "./usage-state.ts";

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

const stats = (sessionId: string, overrides: Partial<SessionStats> = {}): SessionStats => ({
  sessionId,
  messageCount: 2,
  cachedTokens: 30,
  uncachedTokens: 70,
  totalTokens: 100,
  costTotal: 0.25,
  ...overrides,
});

describe("summarizeUsage", () => {
  it("sums only exact per-session statistics across active and archived sessions", () => {
    const summary = summarizeUsage([
      { session: session("active"), stats: stats("active") },
      {
        session: session("archived", true),
        stats: stats("archived", {
          messageCount: 3,
          cachedTokens: 20,
          uncachedTokens: 180,
          totalTokens: 200,
          costTotal: 0.75,
        }),
      },
    ]);

    expect(summary).toEqual({
      sessions: 2,
      messages: 5,
      cachedTokens: 50,
      uncachedTokens: 250,
      totalTokens: 300,
      cost: 1,
    });
  });

  it("returns literal zeroes for an empty exact data set", () => {
    expect(summarizeUsage([])).toEqual({
      sessions: 0,
      messages: 0,
      cachedTokens: 0,
      uncachedTokens: 0,
      totalTokens: 0,
      cost: 0,
    });
  });
});

describe("usage state", () => {
  it("keeps an exact partial snapshot and its explicit problems", () => {
    const snapshot = {
      catalogComplete: false,
      listedSessionCount: 2,
      records: [{ session: session("active"), stats: stats("active") }],
      problems: ["archived: stats unavailable"],
    };

    expect(receiveUsage(initialUsageState, snapshot)).toEqual({ status: "ready", snapshot });
  });

  it("keeps a screen-level request failure separate from an empty snapshot", () => {
    expect(usageFailed(initialUsageState, "connection refused")).toEqual({
      status: "failed",
      failure: "connection refused",
    });
  });
});
