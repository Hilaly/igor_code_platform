// @vitest-environment jsdom

import type { SessionEntry, SessionForkRequest } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionMessageList } from "./session-message-list.tsx";
import type { OpenSession } from "./state.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

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
    className?: string;
    before?: ReactNode;
    after?: ReactNode;
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
      className={options.className}
      before={options.before}
      after={options.after}
    />,
  );

describe("the session message list", () => {
  it("keeps its slots, loading, and empty state inside its single log", () => {
    const view = show(openSession(), {
      className: "sessions-chat-scroll",
      before: <span>до истории</span>,
      after: <span>после истории</span>,
    });
    const log = screen.getByRole("log", { name: "Переписка" });

    expect(log.classList.contains("sessions-chat-scroll")).toBe(true);
    expect(within(log).getByText("до истории")).toBeDefined();
    expect(within(log).getByText("Пока ничего не сказано")).toBeDefined();
    expect(within(log).getByText("после истории")).toBeDefined();

    view.rerender(
      <SessionMessageList
        open={openSession({ loading: true })}
        busy={false}
        archived={false}
        onFork={vi.fn()}
        onSetLabel={vi.fn()}
        labelRefusal={undefined}
        onLabelRefusalChange={vi.fn()}
        translator={translator}
      />,
    );

    expect(
      within(screen.getByRole("log", { name: "Переписка" })).getByText("Загрузка…"),
    ).toBeDefined();
  });

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

  it("keeps live tool calls in an agent message and renders live channels as markdown", () => {
    show(
      openSession({
        live: {
          turnId: "turn-1",
          order: ["turn-1:message", "turn-1:tool"],
          items: {
            "turn-1:message": {
              kind: "message",
              messageId: "turn-1:message",
              role: "agent",
              text: "**форматируемый ответ**",
              reasoning: "**форматируемый reasoning**",
              done: false,
            },
            "turn-1:tool": {
              kind: "tool",
              toolCallId: "tool-1",
              toolName: "read_file",
              input: { path: "README.md" },
              done: false,
            },
          },
        },
      }),
    );

    expect(screen.getByText("форматируемый ответ").tagName).toBe("STRONG");
    expect(screen.getByText("форматируемый reasoning").tagName).toBe("STRONG");
    expect(screen.getByText("read_file").closest('[data-role="agent"]')).not.toBeNull();
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

    expect(summary?.textContent).toBe("◇unknown_tool✓Готово");
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

    expect(screen.queryByRole("button", { name: "Метка этой записи" })).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Снять метку" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Пометить запись" }));
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

  it("shows saved entry date and time with the role-specific action set", () => {
    const user = { ...message("m1", "вопрос", "user"), time: "2026-07-29T07:02:00" };
    const agent = { ...message("m2", "ответ"), time: "2026-07-29T07:02:00" };

    show(
      openSession({
        entries: [user, agent],
        branchEntryIds: new Set([user.id, agent.id]),
      }),
    );

    const times = screen.getAllByText("29.07.2026, 07:02");

    expect(times).toHaveLength(2);
    expect(times.every((time) => time.tagName === "TIME")).toBe(true);
    expect(times.every((time) => time.getAttribute("datetime") === "2026-07-29T07:02:00")).toBe(
      true,
    );
    expect(screen.getAllByRole("button", { name: "Форк до этой реплики" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Форк по эту запись" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Пометить запись" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Снять метку" })).toHaveLength(2);
  });

  it("keeps message actions visible but disabled while busy", () => {
    const entry = message("m1", "занятая реплика", "user");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }), { busy: true });

    for (const name of [
      "Форк до этой реплики",
      "Форк по эту запись",
      "Пометить запись",
      "Снять метку",
    ]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("keeps a busy action row keyboard-reachable when the message has no copyable text", () => {
    const entry: SessionEntry = {
      id: "m1",
      time: "2026-07-29T00:00:00.000Z",
      kind: "message",
      role: "agent",
      content: [{ kind: "reasoning", text: "скрытая мысль" }],
    };

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }), { busy: true });

    const actions = screen.getByRole("group", { name: "Действия сообщения" });

    expect(actions.tabIndex).toBe(0);
    actions.focus();
    expect(document.activeElement).toBe(actions);
  });

  it("omits an invalid saved entry time without hiding its actions", () => {
    const entry = { ...message("m1", "реплика без времени"), time: "invalid" };

    const view = show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }));

    expect(view.container.querySelector("time")).toBeNull();
    expect(screen.getByRole("button", { name: "Форк по эту запись" })).toBeTruthy();
  });

  it("keeps read-only actions but does not offer label actions for archived messages", () => {
    const entry = message("m1", "сохранено");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }), {
      archived: true,
    });

    expect(screen.getByText("сохранено")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Форк по эту запись" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Пометить запись" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Снять метку" })).toBeNull();
  });

  it("copies only the text blocks of the selected message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const entry: SessionEntry = {
      id: "m1",
      time: "2026-07-29T00:00:00.000Z",
      kind: "message",
      role: "agent",
      content: [
        { kind: "text", text: "первая часть" },
        { kind: "reasoning", text: "скрытая мысль" },
        { kind: "tool-call", toolCallId: "tool-1", toolName: "read", input: {} },
        { kind: "text", text: "вторая часть" },
      ],
    };

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }));

    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("первая часть\n\nвторая часть"));
    expect(screen.getByRole("button", { name: "Скопировано" })).toBeTruthy();
  });

  it("does not offer copying when a message has no text blocks", () => {
    const entry: SessionEntry = {
      id: "m1",
      time: "2026-07-29T00:00:00.000Z",
      kind: "message",
      role: "agent",
      content: [
        { kind: "reasoning", text: "скрытая мысль" },
        { kind: "tool-call", toolCallId: "tool-1", toolName: "read", input: {} },
      ],
    };

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }));

    expect(screen.queryByRole("button", { name: "Копировать" })).toBeNull();
  });

  it("does not offer copying for whitespace-only text blocks", () => {
    const entry = message("m1", " \n\t ");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }));

    expect(screen.queryByRole("button", { name: "Копировать" })).toBeNull();
  });

  it("reports clipboard refusal without claiming that the text was copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const entry = message("m1", "не копируется");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }));

    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("denied"));
    expect(screen.getByRole("button", { name: "Копировать" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Скопировано" })).toBeNull();
  });

  it("keeps the newest copied message when two clipboard writes settle out of order", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const writeText = vi
      .fn()
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const first = message("m1", "первая");
    const second = message("m2", "вторая");

    show(
      openSession({
        entries: [first, second],
        branchEntryIds: new Set([first.id, second.id]),
      }),
    );

    const firstMessage = screen.getByText("первая").closest(".sessions-entry-message");
    const secondMessage = screen.getByText("вторая").closest(".sessions-entry-message");

    if (firstMessage === null || secondMessage === null) {
      throw new Error("message wrappers are missing");
    }

    fireEvent.click(
      within(firstMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    );
    fireEvent.click(
      within(secondMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    );

    await act(async () => secondWrite.resolve());
    expect(
      within(secondMessage as HTMLElement).getByRole("button", { name: "Скопировано" }),
    ).toBeTruthy();

    await act(async () => firstWrite.resolve());
    expect(
      within(firstMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    ).toBeTruthy();
    expect(
      within(secondMessage as HTMLElement).getByRole("button", { name: "Скопировано" }),
    ).toBeTruthy();
  });

  it("ignores a stale clipboard refusal after a newer copy succeeds", async () => {
    const staleWrite = deferred<void>();
    const freshWrite = deferred<void>();
    const writeText = vi
      .fn()
      .mockReturnValueOnce(staleWrite.promise)
      .mockReturnValueOnce(freshWrite.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const first = message("m1", "первая");
    const second = message("m2", "вторая");

    show(
      openSession({
        entries: [first, second],
        branchEntryIds: new Set([first.id, second.id]),
      }),
    );

    const firstMessage = screen.getByText("первая").closest(".sessions-entry-message");
    const secondMessage = screen.getByText("вторая").closest(".sessions-entry-message");

    if (firstMessage === null || secondMessage === null) {
      throw new Error("message wrappers are missing");
    }

    fireEvent.click(
      within(firstMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    );
    fireEvent.click(
      within(secondMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    );

    await act(async () => freshWrite.resolve());
    await act(async () => staleWrite.reject(new Error("obsolete denial")));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      within(secondMessage as HTMLElement).getByRole("button", { name: "Скопировано" }),
    ).toBeTruthy();
  });

  it("clears an old copy confirmation when a newer clipboard write starts", async () => {
    const pendingWrite = deferred<void>();
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(pendingWrite.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const first = message("m1", "первая");
    const second = message("m2", "вторая");

    show(
      openSession({
        entries: [first, second],
        branchEntryIds: new Set([first.id, second.id]),
      }),
    );

    const firstMessage = screen.getByText("первая").closest(".sessions-entry-message");
    const secondMessage = screen.getByText("вторая").closest(".sessions-entry-message");

    if (firstMessage === null || secondMessage === null) {
      throw new Error("message wrappers are missing");
    }

    fireEvent.click(
      within(firstMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    );
    await waitFor(() =>
      expect(
        within(firstMessage as HTMLElement).getByRole("button", { name: "Скопировано" }),
      ).toBeTruthy(),
    );

    fireEvent.click(
      within(secondMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    );

    expect(
      within(firstMessage as HTMLElement).getByRole("button", { name: "Копировать" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Скопировано" })).toBeNull();
  });

  it("returns the copy confirmation to its normal label after two seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const entry = message("m1", "реплика");

    show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }));

    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    await act(async () => Promise.resolve());
    expect(screen.getByRole("button", { name: "Скопировано" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "Копировать" })).toBeTruthy();
  });

  it("ignores a clipboard completion after the list unmounts", async () => {
    vi.useFakeTimers();
    const pendingWrite = deferred<void>();
    const writeText = vi.fn().mockReturnValue(pendingWrite.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const entry = message("m1", "реплика");
    const view = show(openSession({ entries: [entry], branchEntryIds: new Set([entry.id]) }));

    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    view.unmount();
    await act(async () => pendingWrite.resolve());

    expect(vi.getTimerCount()).toBe(0);
  });
});
