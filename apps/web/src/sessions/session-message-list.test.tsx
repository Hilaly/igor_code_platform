// @vitest-environment jsdom

import type { SessionEntry } from "@sovereign/protocol";
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
    onSetLabel?: (entryId: string, label: string | null) => Promise<string | undefined>;
  } = {},
) =>
  render(
    <SessionMessageList
      open={open}
      busy={options.busy ?? false}
      archived={options.archived ?? false}
      onFork={vi.fn()}
      onSetLabel={options.onSetLabel ?? vi.fn()}
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
    const entry = message("m1", "реплика");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }), { onSetLabel });

    fireEvent.click(screen.getByRole("button", { name: "Метка этой записи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Пометить запись" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Метка/ }), {
      target: { value: "сюда вернуться" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить метку" }));

    await waitFor(() => expect(onSetLabel).toHaveBeenCalledWith("m1", "сюда вернуться"));
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
