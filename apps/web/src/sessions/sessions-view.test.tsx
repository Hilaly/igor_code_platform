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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsView, type SessionsViewProps } from "./sessions-view.tsx";
import {
  applyBranch,
  applyContext,
  applyDegradation,
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
  archived: false,
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

  return applyBranch(
    applyEntries(applySummary(state, "0199", session(overrides)), "0199", entries, 1),
    "0199",
    { sessionId: "0199", entries },
  );
};

const entryMessage = (
  id: string,
  text: string,
  role: "user" | "agent" = "agent",
): SessionEntry => ({
  id,
  time: "2026-07-29T00:00:00.000Z",
  kind: "message",
  role,
  content: [{ kind: "text", text }],
});

const show = (state: SessionsState, handlers: Partial<SessionsViewProps> = {}) =>
  render(
    <SessionsView
      state={state}
      onOpen={vi.fn()}
      onPrepareDraft={vi.fn()}
      onPickProvider={vi.fn()}
      onCreate={vi.fn()}
      onSubmit={vi.fn()}
      onSendMessage={vi.fn()}
      onInterrupt={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      onFork={vi.fn()}
      onCompact={vi.fn()}
      onSetLabel={vi.fn()}
      onNavigate={vi.fn()}
      onShowArchived={vi.fn()}
      {...handlers}
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

  it("shows only the active branch after navigating to its leaf", () => {
    const root = message("root", "общий корень", "user");
    const first = { ...message("first", "первая попытка"), parentId: "root" };
    const second = { ...message("second", "вторая попытка"), parentId: "root" };
    const entries = [root, first, second];
    const activeBranch = applyBranch(withOpen(entries), "0199", {
      sessionId: "0199",
      entries: [root, second],
      leafId: "second",
    });

    show(activeBranch);

    expect(screen.getByText("общий корень")).not.toBeNull();
    expect(screen.getByText("вторая попытка")).not.toBeNull();
    expect(screen.queryByText("первая попытка")).toBeNull();
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

    show(withOpen(), { onSubmit });

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "привет" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(onSubmit).toHaveBeenCalledWith("привет");
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  it("interrupts the running turn from the same place", () => {
    const onInterrupt = vi.fn();

    show(withOpen([], { phase: "turn" }), { onInterrupt });

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

  it("does not render a persisted human message again from the live turn", () => {
    const persisted = message("m1", "привет", "user");
    const live = applySessionDelta(withOpen([persisted], { phase: "turn" }), "0199", "turn-1", {
      kind: "message-start",
      messageId: "turn-1:1",
      role: "user",
    }).state;
    const withText = applySessionDelta(live, "0199", "turn-1", {
      kind: "message-delta",
      messageId: "turn-1:1",
      channel: "text",
      text: "привет",
    }).state;

    show(withText);

    expect(screen.getAllByText("привет")).toHaveLength(1);
  });

  it("still renders steering that repeats an earlier human message", () => {
    const persisted = message("m1", "привет", "user");
    const firstUser = applySessionDelta(
      withOpen([persisted], { phase: "turn" }),
      "0199",
      "turn-1",
      { kind: "message-start", messageId: "turn-1:1", role: "user" },
    ).state;
    const agent = applySessionDelta(firstUser, "0199", "turn-1", {
      kind: "message-start",
      messageId: "turn-1:2",
      role: "agent",
    }).state;
    const steering = applySessionDelta(agent, "0199", "turn-1", {
      kind: "message-start",
      messageId: "turn-1:3",
      role: "user",
    }).state;
    const withText = applySessionDelta(steering, "0199", "turn-1", {
      kind: "message-delta",
      messageId: "turn-1:3",
      channel: "text",
      text: "привет",
    }).state;

    show(withText);

    expect(screen.getAllByText("привет")).toHaveLength(2);
  });

  it("shows the share of the context window, and marks where it folds by itself", () => {
    show(
      applyContext(withOpen(), "0199", {
        sessionId: "0199",
        tokens: 160000,
        contextWindow: 200000,
        threshold: 0.8,
      }),
    );

    expect(screen.getByText("Контекст: 160000 из 200000 (80%)")).not.toBeNull();
    expect(
      screen
        .getByRole("progressbar", { name: "Заполнение контекста" })
        .getAttribute("aria-valuenow"),
    ).toBe("80");
    expect(screen.getByText("Сворачивается сам на 80%")).not.toBeNull();
  });

  it("shows the tokens alone when the window of the model is unknown", () => {
    // Окна нет — доли не существует: полоса «из неизвестно чего» была бы выдуманным числом.
    show(applyContext(withOpen(), "0199", { sessionId: "0199", tokens: 4096, threshold: 0.8 }));

    expect(screen.getByText("Контекст: 4096 токенов")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("marks nothing when the automatic threshold is switched off", () => {
    show(
      applyContext(withOpen(), "0199", {
        sessionId: "0199",
        tokens: 4096,
        contextWindow: 200000,
        threshold: 0,
      }),
    );

    expect(screen.getByRole("progressbar", { name: "Заполнение контекста" })).not.toBeNull();
    expect(screen.queryByText(/Сворачивается сам/)).toBeNull();
  });

  it("says in the feed that the context was folded, and keeps the summary at hand", () => {
    // Иначе агент «забыл» половину разговора без единого следа в переписке.
    show(
      withOpen([
        {
          id: "c1",
          time: "2026-07-29T00:00:00.000Z",
          kind: "compaction",
          summary: "договорились о схеме",
          tokensBefore: 120000,
          fromHook: true,
        },
      ]),
    );

    expect(screen.getByText("Контекст свёрнут, в него ушло 120000 токенов")).not.toBeNull();
    expect(screen.getByText("договорились о схеме")).not.toBeNull();
    expect(screen.getByText("Пересказ").closest("details")?.open).toBe(false);
  });

  it("says that another branch was left behind", () => {
    show(
      withOpen([
        {
          id: "b1",
          time: "2026-07-29T00:00:00.000Z",
          kind: "branch-summary",
          fromId: "e9",
          summary: "там чинили другое",
          fromHook: false,
        },
      ]),
    );

    expect(screen.getByText(/Другая ветка оставлена/)).not.toBeNull();
    expect(screen.getByText("там чинили другое")).not.toBeNull();
  });

  it("shows a message of the application only while it asks to be shown", () => {
    show(
      withOpen([
        {
          id: "x1",
          time: "2026-07-29T00:00:00.000Z",
          kind: "custom-message",
          type: "core.note",
          text: "видно",
          display: true,
        },
        {
          id: "x2",
          time: "2026-07-29T00:00:01.000Z",
          kind: "custom-message",
          type: "core.note",
          text: "не видно",
          display: false,
        },
      ]),
    );

    expect(screen.getByText("видно")).not.toBeNull();
    expect(screen.queryByText("не видно")).toBeNull();
  });

  it("keeps the bookkeeping of the tree out of the conversation", () => {
    show(
      withOpen([
        message("m1", "реплика"),
        { id: "l1", time: "2026-07-29T00:00:01.000Z", kind: "label", targetId: "m1", label: "тут" },
        { id: "n1", time: "2026-07-29T00:00:02.000Z", kind: "session-name", name: "разбор" },
        { id: "f1", time: "2026-07-29T00:00:03.000Z", kind: "leaf", targetId: "m1" },
      ]),
    );

    expect(screen.queryByText("разбор")).toBeNull();
    // Метка при этом видна — но значком на самой записи, а не строкой в ленте.
    expect(screen.getByText("тут")).not.toBeNull();
  });

  it("keeps an archived session readable without offering a composer", () => {
    show(withOpen([message("m1", "сохранено")], { archived: true }));

    expect(screen.getByText("сохранено")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Сообщение агенту" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });
});

describe("the session lifecycle from the view", () => {
  it("archives a session, carrying its name along so the write does not clear it", () => {
    const onUpdate = vi.fn();

    show(withSessions([session({ title: "разбор бага" })]), { onUpdate });

    fireEvent.click(screen.getByRole("button", { name: "Действия над сессией разбор бага" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "В архив" }));

    // Тело заменяет запись целиком, и тело без имени сняло бы его заодно с архивацией.
    expect(onUpdate).toHaveBeenCalledWith("0199", { archived: true, title: "разбор бага" });
  });

  it("keeps the row action beside the row selection instead of nesting buttons", () => {
    show(withSessions([session({ title: "разбор бага" })]));

    const action = screen.getByRole("button", { name: "Действия над сессией разбор бага" });

    expect(action.closest("button")).toBe(action);
  });

  it("offers to restore an archived session instead of archiving it again", () => {
    show(withSessions([session({ archived: true })]));

    fireEvent.click(screen.getByRole("button", { name: /Действия над сессией/ }));

    expect(screen.queryByRole("menuitem", { name: "В архив" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Вернуть из архива" })).not.toBeNull();
  });

  it("leaves archiving and deleting out of reach while the session is busy", () => {
    show(withSessions([session({ phase: "turn" })]));

    fireEvent.click(screen.getByRole("button", { name: /Действия над сессией/ }));

    expect(
      screen.getByRole("menuitem", { name: "В архив" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Удалить безвозвратно" }).getAttribute("disabled"),
    ).not.toBeNull();
    // Переименование остаётся доступным: это запись в дерево, а не перенос файла.
    expect(
      screen.getByRole("menuitem", { name: "Переименовать" }).getAttribute("disabled"),
    ).toBeNull();
  });

  it("asks before deleting for good, and says what happens to the forks", () => {
    const onRemove = vi.fn();

    show(withSessions([session({ title: "разбор бага" })]), { onRemove });

    fireEvent.click(screen.getByRole("button", { name: /Действия над сессией/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить безвозвратно" }));

    expect(screen.getByText(/Форки этой сессии останутся/)).not.toBeNull();
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Удалить безвозвратно" }));

    expect(onRemove).toHaveBeenCalledWith("0199");
  });

  it("renames a session, and an empty name leaves it unnamed", () => {
    const onUpdate = vi.fn();

    show(withSessions([session({ title: "старое" })]), { onUpdate });

    fireEvent.click(screen.getByRole("button", { name: /Действия над сессией/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Имя/ }), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Переименовать" }));

    expect(onUpdate).toHaveBeenCalledWith("0199", { archived: false });
  });

  it("switches the list to the archive", () => {
    const onShowArchived = vi.fn();

    show(withSessions([session()]), { onShowArchived });

    fireEvent.click(screen.getByRole("checkbox", { name: "Показать архив" }));

    expect(onShowArchived).toHaveBeenCalledWith(true);
  });

  it("turns the send button into a choice of queues while the turn runs", () => {
    const onSendMessage = vi.fn();
    const onSubmit = vi.fn();

    show(withOpen([], { phase: "turn" }), { onSendMessage, onSubmit });

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "возьми левее" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Вклинить" }));

    // Турна у занятой сессии не запустить, и кнопка отправки честно делает другое.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSendMessage).toHaveBeenCalledWith({ text: "возьми левее", mode: "steer" });
  });

  it("can append a message in an idle session without starting a turn", () => {
    const onSendMessage = vi.fn();
    const onSubmit = vi.fn();

    show(withOpen(), { onSendMessage, onSubmit });

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "заметка" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Дописать без запуска" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSendMessage).toHaveBeenCalledWith({ text: "заметка", mode: "append" });
  });

  it("forks before a human question or through any visible message", () => {
    const onFork = vi.fn();
    const entries: SessionEntry[] = [
      {
        id: "e1",
        time: "2026-07-29T00:00:00.000Z",
        kind: "message",
        role: "user",
        content: [{ kind: "text", text: "вопрос" }],
      },
      {
        id: "e2",
        time: "2026-07-29T00:00:01.000Z",
        kind: "message",
        role: "agent",
        content: [{ kind: "text", text: "ответ" }],
      },
    ];

    show(withOpen(entries), { onFork });

    const before = screen.getAllByRole("button", { name: "Форк до этой реплики" });
    const through = screen.getAllByRole("button", { name: "Форк по эту запись" });

    expect(before).toHaveLength(1);
    expect(through).toHaveLength(2);
    fireEvent.click(before[0] as HTMLElement);
    expect(onFork).toHaveBeenCalledWith({ entryId: "e1" });
    fireEvent.click(through[1] as HTMLElement);
    expect(onFork).toHaveBeenLastCalledWith({ entryId: "e2", position: "at" });
  });

  it("forks the whole session without inventing an entry id", () => {
    const onFork = vi.fn();

    show(withOpen(), { onFork });

    fireEvent.click(screen.getByRole("button", { name: "Форк всей сессии" }));

    expect(onFork).toHaveBeenCalledWith({});
  });

  it("asks before folding the context, and carries the instructions of the summary", async () => {
    // Компакция необратима и стоит обращения к модели: спросить обязаны до, а не после.
    const onCompact = vi.fn().mockResolvedValue(undefined);

    show(withOpen(), { onCompact });

    fireEvent.click(screen.getByRole("button", { name: "Свернуть контекст" }));

    expect(screen.getByText(/Обратного хода нет/)).not.toBeNull();
    expect(onCompact).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: /Что пересказ обязан сохранить/ }), {
      target: { value: "сохрани решения" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));

    await waitFor(() => expect(onCompact).toHaveBeenCalledWith("сохрани решения"));
  });

  it("folds by the prompt of the runtime when no instructions were given", async () => {
    const onCompact = vi.fn().mockResolvedValue(undefined);

    show(withOpen(), { onCompact });

    fireEvent.click(screen.getByRole("button", { name: "Свернуть контекст" }));
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));

    await waitFor(() => expect(onCompact).toHaveBeenCalledWith(undefined));
  });

  it("says why a compaction was refused instead of swallowing the reason", async () => {
    // Снимок мог устареть между отрисовкой и нажатием: причина от демона — то, что показывают.
    const onCompact = vi.fn().mockResolvedValue("the session is busy");

    show(withOpen(), { onCompact });

    fireEvent.click(screen.getByRole("button", { name: "Свернуть контекст" }));
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));

    expect(await screen.findByText(/the session is busy/)).not.toBeNull();
  });

  it("does not offer to fold the context of an archived session at all", () => {
    // Сервер отклонит её `409`: кнопка обещала бы невозможное, а архив — состояние, а не задержка.
    show(withOpen([entryMessage("m1", "сохранено")], { archived: true }));

    expect(screen.queryByRole("button", { name: "Свернуть контекст" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Метка этой записи" })).toBeNull();
  });

  it("keeps folding and marking visible but switched off while the session is busy", () => {
    // Занятость проходит сама, и контрол, исчезающий на время турна, хуже выключенного.
    show(withOpen([entryMessage("m1", "реплика")], { phase: "turn" }));

    expect(screen.getByRole("button", { name: "Свернуть контекст" }).hasAttribute("disabled")).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Метка этой записи" }));

    expect(
      screen.getByRole("menuitem", { name: "Пометить запись" }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("marks an entry and shows the mark on it", async () => {
    const onSetLabel = vi.fn().mockResolvedValue(undefined);

    show(withOpen([entryMessage("m1", "реплика")]), { onSetLabel });

    fireEvent.click(screen.getByRole("button", { name: "Метка этой записи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Пометить запись" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Метка/ }), {
      target: { value: "сюда вернуться" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить метку" }));

    await waitFor(() => expect(onSetLabel).toHaveBeenCalledWith("m1", "сюда вернуться"));
  });

  it("shows the mark that holds and offers to take it off", async () => {
    const onSetLabel = vi.fn().mockResolvedValue(undefined);
    const marked = withOpen([
      entryMessage("m1", "реплика"),
      { id: "l1", time: "2026-07-29T00:00:01.000Z", kind: "label", targetId: "m1", label: "тут" },
    ]);

    show(marked, { onSetLabel });

    expect(screen.getByText("тут")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Метка этой записи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Снять метку" }));

    // `null`, а не пустая строка: отличать «снять» от «не трогать» обязан отправитель.
    await waitFor(() => expect(onSetLabel).toHaveBeenCalledWith("m1", null));
  });

  it("leaves nothing to take off while the entry has no mark", () => {
    show(withOpen([entryMessage("m1", "реплика")]));

    fireEvent.click(screen.getByRole("button", { name: "Метка этой записи" }));

    expect(
      screen.getByRole("menuitem", { name: "Снять метку" }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("says why a mark was refused", async () => {
    const onSetLabel = vi.fn().mockResolvedValue("the session is archived");

    show(withOpen([entryMessage("m1", "реплика")]), { onSetLabel });

    fireEvent.click(screen.getByRole("button", { name: "Метка этой записи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Пометить запись" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Метка/ }), {
      target: { value: "тут" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить метку" }));

    expect(await screen.findByText(/the session is archived/)).not.toBeNull();
  });

  it("opens the tree on the branch the session works in, with the leaf picked", async () => {
    // e2 переспросили иначе: рабочая ветка — вторая, и раскрыта должна быть она.
    const forked = applyBranch(
      withOpen([
        entryMessage("e1", "вопрос", "user"),
        { ...entryMessage("e2", "ответ"), parentId: "e1" },
        { ...entryMessage("a1", "первая попытка"), parentId: "e2" },
        { ...entryMessage("b1", "вторая попытка"), parentId: "e2" },
      ]),
      "0199",
      { sessionId: "0199", entries: [], leafId: "b1" },
    );

    show(forked);

    fireEvent.click(screen.getByRole("button", { name: "Дерево записей" }));

    const leaf = await screen.findByRole("treeitem", { name: /вторая попытка/ });

    expect(leaf.getAttribute("aria-selected")).toBe("true");
    // Ветвление добавило уровень, а линейное начало разговора осталось на первом.
    expect(leaf.getAttribute("aria-level")).toBe("2");
    expect(
      screen.getByRole("treeitem", { name: /Человек: вопрос/ }).getAttribute("aria-level"),
    ).toBe("1");
  });

  it("goes to the entry and puts the text it gave back into the composer", async () => {
    // Ради этого переход к своей реплике и делается: переспросить иначе тем же текстом.
    const onNavigate = vi.fn().mockResolvedValue({
      kind: "navigated",
      navigated: { sessionId: "0199", leafId: "e1", editorText: "вопрос", summarized: false },
    });

    show(withOpen([entryMessage("e1", "вопрос", "user")]), { onNavigate });

    fireEvent.click(screen.getByRole("button", { name: "Дерево записей" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: /Человек: вопрос/ }));
    fireEvent.click(screen.getByRole("button", { name: "Перейти к записи" }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ entryId: "e1" }));
    // Панель закрывается сама: то, что она показывала, относится теперь к другой ветке.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
    ).toBe("вопрос");
  });

  it("asks for the summary of the branch being left only when told to", async () => {
    const onNavigate = vi.fn().mockResolvedValue({
      kind: "navigated",
      navigated: { sessionId: "0199", leafId: "e1", summarized: true },
    });

    show(withOpen([entryMessage("e1", "вопрос", "user")]), { onNavigate });

    fireEvent.click(screen.getByRole("button", { name: "Дерево записей" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: /Человек: вопрос/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Пересказать покидаемую ветку" }));
    fireEvent.click(screen.getByRole("button", { name: "Перейти к записи" }));

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith({ entryId: "e1", summarize: true }),
    );
  });

  it("says why a move was refused and keeps the panel open", async () => {
    const onNavigate = vi
      .fn()
      .mockResolvedValue({ kind: "refused", reason: "the session is busy" });

    show(withOpen([entryMessage("e1", "вопрос", "user")]), { onNavigate });

    fireEvent.click(screen.getByRole("button", { name: "Дерево записей" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: /Человек: вопрос/ }));
    fireEvent.click(screen.getByRole("button", { name: "Перейти к записи" }));

    expect(await screen.findByText(/the session is busy/)).not.toBeNull();
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("shows the mark of an entry in the tree and lets it be written there", async () => {
    const onSetLabel = vi.fn().mockResolvedValue(undefined);

    show(
      withOpen([
        entryMessage("e1", "вопрос", "user"),
        { id: "l1", time: "2026-07-29T00:00:01.000Z", kind: "label", targetId: "e1", label: "тут" },
      ]),
      { onSetLabel },
    );

    fireEvent.click(screen.getByRole("button", { name: "Дерево записей" }));

    const node = await screen.findByRole("treeitem", { name: /Человек: вопрос/ });

    // Метка попадает в имя узла: она часть того, что скринридер называет.
    expect(node.getAttribute("aria-label")).toBeNull();
    expect(node.textContent).toContain("тут");

    fireEvent.click(node);
    fireEvent.click(screen.getByRole("button", { name: "Снять метку" }));

    await waitFor(() => expect(onSetLabel).toHaveBeenCalledWith("e1", null));
  });

  it("offers no writing at all in the tree of an archived session", async () => {
    show(withOpen([entryMessage("e1", "вопрос", "user")], { archived: true }));

    fireEvent.click(screen.getByRole("button", { name: "Дерево записей" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: /Человек: вопрос/ }));

    expect(screen.getByText(/Сессия в архиве/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Перейти к записи" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Снять метку" })).toBeNull();
  });

  it("says what the session lost, keeping every loss", () => {
    const lost = applyDegradation(
      applyDegradation(withOpen(), "0199", { kind: "tool", name: "bash" }),
      "0199",
      { kind: "model", name: "anthropic/claude" },
    );

    show(lost);

    expect(screen.getByText(/Инструмент bash исчез/)).not.toBeNull();
    expect(screen.getByText(/Модели anthropic\/claude больше нет/)).not.toBeNull();
  });
});
