// @vitest-environment jsdom

import type { ModelSummary, Project, ProviderSummary, Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatView, type ChatViewProps } from "./chat-view.tsx";
import type { OpenSession } from "./state.ts";
import { ShellHeaderActions, ShellHeaderProvider, useActiveShellHeader } from "../shell/header.tsx";
import { ViewHeader } from "@sovereign/ui-kit";

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

const summary: Session = {
  id: "0199",
  projectId: "project-1",
  folder: "/code/platform",
  agentId: "starter.generic",
  agentAvailable: true,
  model: "anthropic/claude-opus-4-5",
  thinkingLevel: "high",
  phase: "idle",
  title: "План релиза",
  archived: false,
  createdAt: "2026-08-05T00:00:00.000Z",
};

const anthropic: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [],
  auth: { kind: "configured", type: "api_key" },
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 1,
};

const google: ProviderSummary = {
  ...anthropic,
  id: "google",
  name: "Google",
};

const model = (overrides: Partial<ModelSummary> = {}): ModelSummary => ({
  id: "claude-opus-4-5",
  name: "Claude Opus 4.5",
  providerId: "anthropic",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: true,
  input: ["text"],
  cost: { input: 3, output: 15 },
  ...overrides,
});

const providers = [anthropic, google];
const models: ChatViewProps["models"] = {
  anthropic: { kind: "ready", models: [model()] },
  google: {
    kind: "ready",
    models: [
      model({
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        providerId: "google",
      }),
    ],
  },
};

const openSession = (
  sessionSummary: Session | undefined,
  overrides: Partial<OpenSession> = {},
): OpenSession => ({
  id: sessionSummary?.id ?? "0199",
  summary: sessionSummary,
  entries: [],
  seen: 0,
  pending: {},
  labels: new Map(),
  branchEntryIds: new Set(),
  degradations: [],
  loading: false,
  stats: {
    sessionId: sessionSummary?.id ?? "0199",
    messageCount: 2,
    cachedTokens: 120,
    uncachedTokens: 30,
    totalTokens: 150,
    costTotal: 0.0042,
  },
  context: {
    sessionId: sessionSummary?.id ?? "0199",
    tokens: 40_000,
    contextWindow: 200_000,
    threshold: 0.8,
  },
  ...overrides,
});

const chatProps = (open: OpenSession, overrides: Partial<ChatViewProps> = {}): ChatViewProps => ({
  open,
  providers,
  models,
  onPrepareModels: vi.fn(),
  onLoadModels: vi.fn(),
  onSubmit: vi.fn(() => new Promise<string | undefined>(() => undefined)),
  onQueueMessage: vi.fn(() => Promise.resolve(undefined)),
  onSendMessage: vi.fn(() => Promise.resolve(undefined)),
  onResumeQueue: vi.fn(() => Promise.resolve(undefined)),
  onSteerQueuedMessage: vi.fn(() => Promise.resolve(undefined)),
  onDropQueuedMessage: vi.fn(() => Promise.resolve(undefined)),
  onInterrupt: vi.fn(),
  onFork: vi.fn(() => Promise.resolve()),
  onCompact: vi.fn(() => Promise.resolve(undefined)),
  onUpdateSession: vi.fn(() => Promise.resolve(undefined)),
  onSetLabel: vi.fn(() => Promise.resolve(undefined)),
  onNavigate: vi.fn(() => Promise.resolve({ kind: "refused" as const, reason: "unused" })),
  translator,
  ...overrides,
});

const show = (open: OpenSession, overrides: Partial<ChatViewProps> = {}) => {
  const props = chatProps(open, overrides);
  const onSubmit = props.onSubmit;
  const onQueueMessage = props.onQueueMessage;
  const onNavigate: ChatViewProps["onNavigate"] = vi.fn(() =>
    Promise.resolve({ kind: "refused" as const, reason: "unused" }),
  );
  props.onNavigate = onNavigate;

  return {
    ...render(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView {...props} />
      </ShellHeaderProvider>,
    ),
    onSubmit,
    onQueueMessage,
    props,
  };
};

/**
 * Проба шапки собирает полосу так же, как оболочка: действия приходят данными, и превратить их в
 * кнопку и меню «ещё» — её работа, а не работа вью.
 */
function HeaderProbe(): React.JSX.Element {
  const { actions, ...description } = useActiveShellHeader();

  return (
    <ViewHeader
      {...description}
      actions={<ShellHeaderActions actions={actions} moreLabel="Ещё действия" />}
    />
  );
}

/** Открыть меню «ещё» шапки: в полосе у чата остаётся только оно. */
function openHeaderMenu(header: HTMLElement): void {
  fireEvent.click(within(header).getByRole("button", { name: "Ещё действия" }));
}

function chooseModel(scope: HTMLElement, provider: string, reference: RegExp): void {
  fireEvent.click(within(scope).getByRole("button", { name: /\/.*·/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
  fireEvent.click(screen.getByRole("treeitem", { name: provider }).querySelector("div")!);
  fireEvent.click(screen.getByRole("treeitem", { name: reference }));
}

function chooseThinking(scope: HTMLElement, level: string): void {
  fireEvent.click(within(scope).getByRole("button", { name: /\/.*·/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
  fireEvent.click(screen.getByRole("option", { name: level }));
}

describe("the session chat view", () => {
  it("puts busy activity above and outside the composer surface", () => {
    const busySummary = { ...summary, phase: "turn" as const };
    const view = show(
      openSession(busySummary, {
        stats: { ...openSession(summary).stats!, totalTokens: 11_000 },
      }),
    );

    const status = screen.getByRole("status", { name: /Идёт турн.*токенов/ });
    const composerSurface = view.container.querySelector(".sessions-composer-surface");
    const raisedSurface = view.container.querySelector(".sessions-composer");

    expect(status.classList.contains("sessions-agent-activity")).toBe(true);
    expect(status.parentElement?.classList.contains("sessions-chat-bottom")).toBe(true);
    expect(status.nextElementSibling).toBe(composerSurface);
    expect(composerSurface?.contains(status)).toBe(false);
    expect(raisedSurface?.contains(status)).toBe(false);
  });

  it("leaves no activity row or gap owner while idle or archived", () => {
    const idle = show(openSession(summary));
    expect(idle.container.querySelector(".sessions-agent-activity")).toBeNull();

    idle.rerender(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView
          {...idle.props}
          open={openSession({ ...summary, archived: true, phase: "idle" })}
        />
      </ShellHeaderProvider>,
    );
    expect(idle.container.querySelector(".sessions-agent-activity")).toBeNull();
    expect(idle.container.querySelector(".sessions-composer-surface")).toBeNull();
  });

  it("puts the session identity and actions in a header above the only chat log", () => {
    const view = show(openSession(summary));
    const heading = screen.getByRole("heading", { level: 1, name: "План релиза" });
    const header = heading.closest("header");

    expect(header).not.toBeNull();
    // Главного действия у чата в полосе нет: отправка живёт в композере, а три редких хода уезжают
    // в меню «ещё» — иначе полоса переносится второй строкой на узком экране.
    openHeaderMenu(header!);
    expect(screen.getByRole("menuitem", { name: "Форк всей сессии" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Свернуть контекст" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Дерево записей" })).toBeDefined();
    expect(view.container.querySelector(".sessions-session-actions")).toBeNull();
    expect(screen.getByRole("log", { name: "Переписка" })).toBeDefined();

    view.rerender(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView {...view.props} open={openSession({ ...summary, title: undefined })} />
      </ShellHeaderProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Новая сессия" })).toBeDefined();
  });

  /**
   * Полоса называет проект, а путь на диске держит подсказкой: путь обрезался первым и занимал место,
   * ничего не сообщая. Без снимка проектов остаётся путь — это единственное, что про сессию известно.
   */
  it("names the project in the header and keeps the folder in a tooltip", () => {
    const project: Project = {
      id: "project-1",
      name: "Sovereign",
      folder: "/code/platform",
      folderKey: "/code/platform",
      archived: false,
      availability: "available",
      sessionCount: 1,
      ephemeral: false,
      createdAt: "2026-08-05T00:00:00.000Z",
    };
    const view = show(openSession(summary), { project });
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;

    expect(within(header).getByTitle("/code/platform").textContent).toBe("Sovereign");
    expect(header.textContent).toContain("Sovereign · anthropic/claude-opus-4-5");
    expect(header.textContent).not.toContain("/code/platform ·");

    view.rerender(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView {...view.props} project={undefined} />
      </ShellHeaderProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).closest("header")!.textContent).toContain(
      "/code/platform ·",
    );
  });

  it("prepares providers and loads only the current model catalogue on mount", () => {
    const onPrepareModels = vi.fn();
    const onLoadModels = vi.fn();
    show(openSession(summary), { onPrepareModels, onLoadModels });

    expect(onPrepareModels).toHaveBeenCalledTimes(1);
    expect(onLoadModels).toHaveBeenCalledTimes(1);
    expect(onLoadModels).toHaveBeenCalledWith("anthropic");

    chooseModel(document.body, "Google", /google\/gemini-2\.5-pro/);
    expect(onLoadModels).toHaveBeenLastCalledWith("google");
  });

  it("isolates drafts, models, and reasoning between two mounted chat panels", () => {
    const firstQueue = vi.fn(() => new Promise<string | undefined>(() => undefined));
    const secondQueue = vi.fn(() => new Promise<string | undefined>(() => undefined));
    render(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <>
          <ChatView {...chatProps(openSession(summary), { onQueueMessage: firstQueue })} />
          <ChatView
            {...chatProps(
              openSession({
                ...summary,
                id: "0299",
                title: "Вторая сессия",
                thinkingLevel: "low",
              }),
              { onQueueMessage: secondQueue },
            )}
          />
        </>
      </ShellHeaderProvider>,
    );
    const [first, second] = Array.from(
      document.querySelectorAll<HTMLElement>(".sessions-chat"),
    ) as [HTMLElement, HTMLElement];

    fireEvent.change(within(first).getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "первая панель" },
    });
    chooseModel(first, "Google", /google\/gemini-2\.5-pro/);
    chooseThinking(first, "Максимальный");
    fireEvent.change(within(second).getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "вторая панель" },
    });
    fireEvent.click(within(first).getByRole("button", { name: "Отправить" }));
    fireEvent.click(within(second).getByRole("button", { name: "Отправить" }));

    expect(firstQueue).toHaveBeenCalledWith({
      text: "первая панель",
      model: "google/gemini-2.5-pro",
      thinkingLevel: "max",
    });
    expect(secondQueue).toHaveBeenCalledWith({
      text: "вторая панель",
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "low",
    });
  });

  it("resets next-turn values only when the open session id changes", () => {
    const view = show(openSession(summary));
    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.change(field, { target: { value: "черновик" } });
    chooseModel(view.container, "Google", /google\/gemini-2\.5-pro/);
    chooseThinking(view.container, "Максимальный");
    view.rerender(
      <ChatView
        {...view.props}
        open={openSession({
          ...summary,
          id: "0299",
          title: "Другая сессия",
          thinkingLevel: "medium",
        })}
      />,
    );

    expect(
      (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
    ).toBe("");
    expect(
      screen.getByRole("button", { name: /anthropic\/claude.*средний/i }).textContent,
    ).toContain("anthropic/claude-opus-4-5");
    expect(
      screen.getByRole("button", { name: /anthropic\/claude.*средний/i }).textContent,
    ).toContain("Средний");
  });

  it("keeps a busy model choice for the message queued afterwards", () => {
    const onQueueMessage = vi.fn(() => new Promise<string | undefined>(() => undefined));
    const busySummary = { ...summary, phase: "turn" as const };
    const view = show(openSession(busySummary), { onQueueMessage });

    chooseModel(view.container, "Google", /google\/gemini-2\.5-pro/);
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "следующий турн" },
    });
    expect(onQueueMessage).not.toHaveBeenCalled();

    view.rerender(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView {...view.props} open={openSession(summary)} />
      </ShellHeaderProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onQueueMessage).toHaveBeenCalledWith({
      text: "следующий турн",
      model: "google/gemini-2.5-pro",
      thinkingLevel: "high",
    });
  });

  it("disables reasoning only when the loaded model explicitly lacks it", async () => {
    const noReasoning = model({ reasoning: false });
    const view = show(openSession(summary), {
      models: { anthropic: { kind: "ready", models: [noReasoning] } },
    });

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /anthropic\/claude.*выключены/i })
          .getAttribute("aria-disabled"),
      ).toBe("false"),
    );
    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*выключены/i }));
    expect(
      screen.getByRole("menuitem", { name: /Уровень рассуждений/ }).getAttribute("aria-disabled"),
    ).toBe("true");

    view.rerender(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView {...view.props} models={{}} />
      </ShellHeaderProvider>,
    );
    expect(screen.getByRole("button", { name: /\/.*·/i }).getAttribute("aria-disabled")).toBe(
      "false",
    );
  });

  it("hydrates next-turn overrides when the first summary arrives for the open session", () => {
    const view = show(openSession(undefined));

    view.rerender(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView {...view.props} open={openSession(summary)} />
      </ShellHeaderProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "привет" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(view.onQueueMessage).toHaveBeenCalledWith({
      text: "привет",
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    });
  });

  it("does not overwrite a prepared thinking level when the first summary arrives", () => {
    const view = show(openSession(undefined));

    fireEvent.click(screen.getByRole("button", { name: /Выберите.*Выключены/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
    fireEvent.click(screen.getByRole("option", { name: "Высокий" }));
    view.rerender(
      <ShellHeaderProvider description={{ title: "Сессии" }}>
        <HeaderProbe />
        <ChatView {...view.props} open={openSession({ ...summary, thinkingLevel: "medium" })} />
      </ShellHeaderProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "сохрани выбор" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(view.onQueueMessage).toHaveBeenCalledWith({
      text: "сохрани выбор",
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    });
  });
});

describe("the session queue in the chat view", () => {
  const waitingSession = (busy: boolean) =>
    openSession(busy ? { ...summary, phase: "turn" as const } : summary, {
      outbox: { messages: [{ id: "q-1", text: "потом" }] },
    });

  it("shows what waits and takes it off the queue", async () => {
    const onDropQueuedMessage = vi.fn(() => Promise.resolve(undefined));

    show(waitingSession(false), { onDropQueuedMessage });

    expect(screen.getByText("потом")).not.toBeNull();
    // Вклиниваться в простое некуда, и кнопка обещала бы то, чего демон не сделает.
    expect(screen.queryByRole("button", { name: "Вклинить в текущий турн" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Снять с очереди" }));
    await waitFor(() => expect(onDropQueuedMessage).toHaveBeenCalledWith("q-1"));
  });

  it("offers steering only while a turn runs", async () => {
    const onSteerQueuedMessage = vi.fn(() => Promise.resolve(undefined));

    show(waitingSession(true), { onSteerQueuedMessage });

    fireEvent.click(screen.getByRole("button", { name: "Вклинить в текущий турн" }));
    await waitFor(() => expect(onSteerQueuedMessage).toHaveBeenCalledWith("q-1"));
  });

  it("names the reason the queue stopped and offers to continue it", async () => {
    const onResumeQueue = vi.fn(() => Promise.resolve(undefined));

    show(
      openSession(summary, {
        outbox: {
          messages: [{ id: "q-1", text: "потом" }],
          stopped: { reason: "the model is gone" },
        },
      }),
      { onResumeQueue },
    );

    expect(screen.getByText(/the model is gone/)).not.toBeNull();
    // Остановленная очередь цела: продолжить её — одно нажатие, а не переписывание заново.
    expect(screen.getByText("потом")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await waitFor(() => expect(onResumeQueue).toHaveBeenCalled());
  });
});
