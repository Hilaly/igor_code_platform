import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionEntry } from "@sovereign/sdk";

import { findToolCall } from "./entries.ts";

function callEntry(toolCallId: string, toolName: string, input: unknown): SessionEntry {
  return {
    id: `m-${toolCallId}`,
    time: "2026-08-16T12:00:00.000Z",
    kind: "message",
    role: "agent",
    content: [{ kind: "tool-call", toolCallId, toolName, input }],
  };
}

function resultEntry(toolCallId: string, text: string, failed: boolean): SessionEntry {
  return {
    id: `r-${toolCallId}`,
    time: "2026-08-16T12:00:01.000Z",
    kind: "tool-result",
    toolCallId,
    toolName: "bash",
    text,
    failed,
  };
}

describe("findToolCall", () => {
  it("finds a call without a result", () => {
    const found = findToolCall([callEntry("c1", "bash", { command: "ls" })], "c1");
    assert.deepEqual(found, { input: { command: "ls" } });
  });

  it("finds the call and its result", () => {
    const entries = [callEntry("c1", "bash", { command: "ls" }), resultEntry("c1", "out", false)];
    const found = findToolCall(entries, "c1");
    assert.deepEqual(found, {
      input: { command: "ls" },
      result: { text: "out", failed: false },
    });
  });

  it("returns undefined for an unknown call id", () => {
    assert.equal(findToolCall([callEntry("c1", "bash", { command: "ls" })], "c2"), undefined);
  });

  it("ignores text blocks and calls with other ids", () => {
    const entries: SessionEntry[] = [
      {
        id: "m0",
        time: "2026-08-16T12:00:00.000Z",
        kind: "message",
        role: "user",
        content: [{ kind: "text", text: "hi" }],
      },
      callEntry("c1", "bash", { command: "ls" }),
    ];
    const found = findToolCall(entries, "c1");
    assert.deepEqual(found, { input: { command: "ls" } });
  });
});
