// @vitest-environment jsdom

/**
 * Вью сессий и панель чата на настоящем DOM. Проверяется то, чего не видно ни в разметке первого
 * кадра, ни глазами за один проход: что «снимка ещё нет» и «сессий нет» показываются по-разному,
 * что дописанное сообщение становится размёткой, а идущее остаётся плоским текстом, что вызов
 * инструмента находит свой результат в записях, и что кнопка меняется на «остановить» по фазе, а не
 * по дельтам.
 *
 * Переводчик здесь бросает на любой ненайденный ключ: непереведённая строка в интерфейсе — не
 * «мелочь на потом», а то, ради чего диагностика вообще заведена (docs/ui-kit.md).
 */

import type { Session, SessionEntry } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsView } from "./sessions-view.tsx";
import {
  applyEntries,
  applyPendingTurn,
  applySessionDelta,
  applySessions,
  applySummary,
  initialSessionsState,
  openSession,
  type SessionsState,
} from "./state.ts";

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

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "0199",
  projectId: "b7Kq",
  folder: "/code/platform",
  agentId: "base-agent.agent",
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "medium",
  phase: "idle",
  createdAt: "2026-07-29T00:00:00.000Z",
  ...overrides,
});

const withSessions = (sessions: Session[]): SessionsState =>
  applySessions(initialSessionsState, { sessions });

const withOpen = (
  entries: SessionEntry[] = [],
  overrides: Partial<Session> = {},
): SessionsState => {
  const state = openSession(withSessions([session(overrides)]), "0199");

  return applyEntries(applySummary(state, "0199", session(overrides)), "0199", entries, 1);
};

const show = (state: SessionsState) =>
  render(
    <SessionsView
      state={state}
      onOpen={vi.fn()}
      onSubmit={vi.fn()}
      onInterrupt={vi.fn()}
      translator={translator}
    />,
  );

describe("the list of sessions", () => {
  it("tells waiting for the first snapshot from an empty platform", () => {
    show(initialSessionsState);
    expect(screen.getByRole("status").textContent).toContain("Загрузка");

    cleanup();
    show(withSessions([]));
    expect(screen.getByText("Сессий пока нет")).not.toBeNull();
  });

  it("names a session without a title instead of showing an empty row", () => {
    // Демон `title` не заполняет никогда: строка без имени — обычный случай, а не редкость.
    show(withSessions([session()]));

    expect(screen.getByText("Сессия без имени")).not.toBeNull();
    expect(screen.getByText("/code/platform")).not.toBeNull();
  });

  it("shows the phase of every session, so a running one is findable", () => {
    show(withSessions([session(), session({ id: "0200", phase: "queued" })]));

    expect(screen.getByText("Простаивает")).not.toBeNull();
    expect(screen.getByText("В очереди")).not.toBeNull();
  });

  it("keeps the list visible when a session file could not be read", () => {
    // Одна битая сессия не отменяет остальные: список обязан остаться на экране.
    show(
      applySessions(initialSessionsState, { sessions: [session()], problems: ["0200: broken"] }),
    );

    expect(screen.getByText("Часть файлов сессий прочитать не вышло")).not.toBeNull();
    expect(screen.getByText("Сессия без имени")).not.toBeNull();
  });

  it("asks to pick a session while none is open", () => {
    show(withSessions([session()]));

    expect(screen.getByText("Сессия не выбрана")).not.toBeNull();
  });

  it("says a session is gone instead of waiting forever", () => {
    const state = applySummary(openSession(withSessions([]), "0199"), "0199", undefined);
    show(state);

    expect(screen.getByText("Такой сессии нет")).not.toBeNull();
  });
});

describe("the chat", () => {
  const message = (id: string, text: string, role: "user" | "agent" = "agent"): SessionEntry => ({
    id,
    time: "2026-07-29T00:00:00.000Z",
    kind: "message",
    role,
    content: [{ kind: "text", text }],
  });

  it("renders the answer of the agent as markdown", () => {
    show(withOpen([message("m1", "ответ с **жирным**")]));

    expect(screen.getByText("жирным").tagName).toBe("STRONG");
  });

  it("folds the reasoning away instead of drowning the answer in it", () => {
    show(
      withOpen([
        {
          id: "m1",
          time: "2026-07-29T00:00:00.000Z",
          kind: "message",
          role: "agent",
          content: [
            { kind: "reasoning", text: "долго думаю" },
            { kind: "text", text: "коротко отвечаю" },
          ],
        },
      ]),
    );

    const details = screen.getByText("Размышления").closest("details");
    expect(details?.open).toBe(false);
    expect(screen.getByText("коротко отвечаю")).not.toBeNull();
  });

  it("gives a tool call the result that came as a separate entry", () => {
    // Результат инструмента — своя запись; в блоке вызова его нет, и связывает их только идентификатор.
    show(
      withOpen([
        {
          id: "m1",
          time: "2026-07-29T00:00:00.000Z",
          kind: "message",
          role: "agent",
          content: [
            {
              kind: "tool-call",
              toolCallId: "call-1",
              toolName: "write_file",
              input: { path: "a" },
            },
          ],
        },
        {
          id: "r1",
          time: "2026-07-29T00:00:01.000Z",
          kind: "tool-result",
          toolCallId: "call-1",
          toolName: "write_file",
          text: "записано",
          failed: false,
        },
      ]),
    );

    expect(screen.getByText("write_file")).not.toBeNull();
    expect(screen.getByText("Готово")).not.toBeNull();
    expect(screen.queryByText("Идёт")).toBeNull();
  });

  it("leaves a tool call running while its result has not arrived", () => {
    show(
      withOpen([
        {
          id: "m1",
          time: "2026-07-29T00:00:00.000Z",
          kind: "message",
          role: "agent",
          content: [{ kind: "tool-call", toolCallId: "call-1", toolName: "bash", input: {} }],
        },
      ]),
    );

    expect(screen.getByText("Идёт")).not.toBeNull();
  });

  it("says a model change with a line of its own, not with a reply", () => {
    show(
      withOpen([
        {
          id: "c1",
          time: "2026-07-29T00:00:00.000Z",
          kind: "model-change",
          model: "anthropic/claude-opus-4-5",
        },
      ]),
    );

    expect(screen.getByText("Модель: anthropic/claude-opus-4-5")).not.toBeNull();
  });

  it("shows an arriving answer as plain text and a finished one as markdown", () => {
    const arriving = applySessionDelta(withOpen(), "0199", "turn-1", {
      kind: "message-delta",
      messageId: "turn-1:1",
      channel: "text",
      text: "ответ с **жирным**",
    }).state;

    show(arriving);
    // Пока дельты идут, размётка не разбирается: незакрытое ограждение перестраивало бы дерево.
    expect(screen.getByText(/ответ с \*\*жирным\*\*/)).not.toBeNull();

    cleanup();
    show(
      applySessionDelta(arriving, "0199", "turn-1", {
        kind: "message-end",
        messageId: "turn-1:1",
      }).state,
    );
    expect(screen.getByText("жирным").tagName).toBe("STRONG");
  });

  it("shows the text of a turn that is still waiting in the queue", () => {
    show(applyPendingTurn(withOpen([], { phase: "queued" }), "0199", "turn-1", "привет"));

    expect(screen.getByText("привет")).not.toBeNull();
    expect(screen.getByText("Ждёт в очереди")).not.toBeNull();
  });

  it("offers to stop while the phase says the session is busy, and to send when it is not", () => {
    // Кнопка смотрит на фазу, а не на дельты: у турна из очереди дельт нет вовсе.
    show(withOpen([], { phase: "turn" }));
    expect(screen.getByRole("button", { name: "Остановить" })).not.toBeNull();

    cleanup();
    show(withOpen());
    expect(screen.getByRole("button", { name: "Отправить" })).not.toBeNull();
  });

  it("does not offer to send an empty message", () => {
    show(withOpen());

    expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(true);
  });

  it("sends what was typed and clears the field", () => {
    const onSubmit = vi.fn();
    render(
      <SessionsView
        state={withOpen()}
        onOpen={vi.fn()}
        onSubmit={onSubmit}
        onInterrupt={vi.fn()}
        translator={translator}
      />,
    );

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "привет" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(onSubmit).toHaveBeenCalledWith("привет");
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  it("interrupts the running turn from the same place", () => {
    const onInterrupt = vi.fn();
    render(
      <SessionsView
        state={withOpen([], { phase: "turn" })}
        onOpen={vi.fn()}
        onSubmit={vi.fn()}
        onInterrupt={onInterrupt}
        translator={translator}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));

    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("shows why a turn did not go through", () => {
    const failed = applySessionDelta(withOpen(), "0199", "turn-1", {
      kind: "turn-failed",
      reason: "the model refused",
    }).state;

    show(failed);

    expect(screen.getByText(/the model refused/)).not.toBeNull();
  });
});
