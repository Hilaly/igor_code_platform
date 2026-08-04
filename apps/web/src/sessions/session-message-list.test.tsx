// @vitest-environment jsdom

import type { SessionEntry, SessionForkRequest } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionMessageList } from "./session-message-list.tsx";
import type { OpenSession } from "./state.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const message = (id: string, text: string, role: "user" | "agent" = "agent"): SessionEntry => ({
  id,
  time: "2026-07-29T00:00:00.000Z",
  kind: "message",
  role,
  content: [{ kind: "text", text }],
});

const openSession = (overrides: Partial<OpenSession> = {}): OpenSession => ({
  id: "0199",
  entries: [],
  seen: 0,
  pending: {},
  labels: new Map(),
  branchEntryIds: new Set(),
  degradations: [],
  loading: false,
  ...overrides,
});

const show = (
  open: OpenSession,
  options: {
    busy?: boolean;
    archived?: boolean;
    onFork?: (request: SessionForkRequest) => Promise<void>;
    onSetLabel?: (entryId: string, label: string | null) => Promise<string | undefined>;
    labelRefusal?: string;
    onLabelRefusalChange?: (reason: string | undefined) => void;
  } = {},
) =>
  render(
    <SessionMessageList
      open={open}
      busy={options.busy ?? false}
      archived={options.archived ?? false}
      onFork={options.onFork ?? vi.fn()}
      onSetLabel={options.onSetLabel ?? vi.fn()}
      labelRefusal={options.labelRefusal}
      onLabelRefusalChange={options.onLabelRefusalChange ?? vi.fn()}
      translator={translator}
    />,
  );

describe("the session message list", () => {
  it("renders persisted entries, pending turns, and live items in that order", () => {
    const persisted = message("m1", "сохранённая реплика");

    show(
      openSession({
        entries: [persisted],
        branchEntryIds: new Set([persisted.id]),
        pending: { "turn-2": "ожидающий турн" },
        live: {
          turnId: "turn-1",
          order: ["turn-1:1"],
          items: {
            "turn-1:1": {
              kind: "message",
              messageId: "turn-1:1",
              role: "agent",
              text: "живой ответ",
              reasoning: "",
              done: false,
            },
          },
        },
      }),
    );

    const persistedNode = screen.getByText("сохранённая реплика");
    const pendingNode = screen.getByText("ожидающий турн");
    const liveNode = screen.getByText("живой ответ");

    expect(persistedNode.compareDocumentPosition(pendingNode)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(pendingNode.compareDocumentPosition(liveNode)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows a path and command in persisted and live tool summaries", () => {
    const persisted: SessionEntry = {
      id: "m1",
      time: "2026-07-29T00:00:00.000Z",
      kind: "message",
      role: "agent",
      content: [
        {
          kind: "tool-call",
          toolCallId: "tool-1",
          toolName: "write_file",
          input: { path: "hello.txt", file: "ignored.txt", command: "echo ignored" },
        },
      ],
    };
    const outcome: SessionEntry = {
      id: "r1",
      time: "2026-07-29T00:00:01.000Z",
      kind: "tool-result",
      toolCallId: "tool-1",
      toolName: "write_file",
      text: "written",
      failed: false,
    };

    show(
      openSession({
        entries: [persisted, outcome],
        branchEntryIds: new Set([persisted.id, outcome.id]),
        live: {
          turnId: "turn-1",
          order: ["turn-1:tool"],
          items: {
            "turn-1:tool": {
              kind: "tool",
              toolCallId: "tool-2",
              toolName: "bash",
              input: { command: "pwd" },
              done: false,
            },
          },
        },
      }),
    );

    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByText("hello.txt")).toBeTruthy();
    expect(screen.getByText("Готово")).toBeTruthy();
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getByText("pwd")).toBeTruthy();
  });

  it("falls back to an unknown tool name when its input has no supported summary", () => {
    show(
      openSession({
        live: {
          turnId: "turn-1",
          order: ["turn-1:tool"],
          items: {
            "turn-1:tool": {
              kind: "tool",
              toolCallId: "tool-1",
              toolName: "unknown_tool",
              input: { path: "", file: 4, command: "" },
              done: true,
              failed: false,
            },
          },
        },
      }),
    );

    const summary = screen.getByText("unknown_tool").closest("summary");

    expect(summary?.textContent).toBe("◇unknown_toolГотово");
  });

  it("deduplicates the persisted first prompt but keeps repeated steering", () => {
    const persisted = message("m1", "привет", "user");

    show(
      openSession({
        entries: [persisted],
        branchEntryIds: new Set([persisted.id]),
        live: {
          turnId: "turn-1",
          order: ["turn-1:prompt", "turn-1:steer"],
          items: {
            "turn-1:prompt": {
              kind: "message",
              messageId: "turn-1:prompt",
              role: "user",
              text: "привет",
              reasoning: "",
              done: true,
            },
            "turn-1:steer": {
              kind: "message",
              messageId: "turn-1:steer",
              role: "user",
              text: "привет",
              reasoning: "",
              done: true,
            },
          },
        },
      }),
    );

    expect(screen.getAllByText("привет")).toHaveLength(2);
  });

  it("keeps message actions and label editing with the list", async () => {
    const onSetLabel = vi.fn().mockResolvedValue(undefined);
    const onLabelRefusalChange = vi.fn();
    const entry = message("m1", "реплика");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }), {
      onSetLabel,
      onLabelRefusalChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Метка этой записи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Пометить запись" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Метка/ }), {
      target: { value: "сюда вернуться" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить метку" }));

    await waitFor(() => expect(onSetLabel).toHaveBeenCalledWith("m1", "сюда вернуться"));
    expect(onLabelRefusalChange).toHaveBeenCalledWith(undefined);
  });

  it("renders the controlled label refusal beside the message list", () => {
    show(openSession(), { labelRefusal: "the session is archived" });

    expect(screen.getByRole("alert").textContent).toContain("the session is archived");
  });

  it("reports fork-before for a user message and fork-at through the selected entry", () => {
    const onFork = vi.fn().mockResolvedValue(undefined);
    const user = message("m1", "вопрос", "user");
    const agent = message("m2", "ответ");

    show(
      openSession({
        entries: [user, agent],
        branchEntryIds: new Set([user.id, agent.id]),
      }),
      { onFork },
    );

    fireEvent.click(screen.getByRole("button", { name: "Форк до этой реплики" }));
    expect(onFork).toHaveBeenCalledWith({ entryId: "m1" });

    fireEvent.click(screen.getAllByRole("button", { name: "Форк по эту запись" })[1] as Element);
    expect(onFork).toHaveBeenLastCalledWith({ entryId: "m2", position: "at" });
  });

  it("does not offer writing actions for archived messages", () => {
    const entry = message("m1", "сохранено");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }), {
      archived: true,
    });

    expect(screen.getByText("сохранено")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Метка этой записи" })).toBeNull();
  });
});
