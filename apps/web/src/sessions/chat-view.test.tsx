// @vitest-environment jsdom

import type { ModelSummary, ProviderSummary, Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatView, type ChatViewProps } from "./chat-view.tsx";
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

const summary: Session = {
  id: "0199",
  projectId: "project-1",
  folder: "/code/platform",
  agentId: "base-agent.agent",
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
  onSendMessage: vi.fn(() => Promise.resolve(undefined)),
  onInterrupt: vi.fn(),
  onFork: vi.fn(() => Promise.resolve()),
  onCompact: vi.fn(() => Promise.resolve(undefined)),
  onSetLabel: vi.fn(() => Promise.resolve(undefined)),
  onNavigate: vi.fn(() => Promise.resolve({ kind: "refused" as const, reason: "unused" })),
  translator,
  ...overrides,
});

const show = (open: OpenSession, overrides: Partial<ChatViewProps> = {}) => {
  const props = chatProps(open, overrides);
  const onSubmit = props.onSubmit;
  const onNavigate: ChatViewProps["onNavigate"] = vi.fn(() =>
    Promise.resolve({ kind: "refused" as const, reason: "unused" }),
  );
  props.onNavigate = onNavigate;

  return { ...render(<ChatView {...props} />), onSubmit, props };
};

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
  it("puts the session identity and actions in a header above the only chat log", () => {
    const view = show(openSession(summary));
    const heading = screen.getByRole("heading", { level: 1, name: "План релиза" });
    const header = heading.closest("header");

    expect(header).not.toBeNull();
    expect(within(header!).getByRole("button", { name: "Форк всей сессии" })).toBeDefined();
    expect(within(header!).getByRole("button", { name: "Свернуть контекст" })).toBeDefined();
    expect(within(header!).getByRole("button", { name: "Дерево записей" })).toBeDefined();
    expect(view.container.querySelector(".sessions-session-actions")).toBeNull();
    expect(screen.getByRole("log", { name: "Переписка" })).toBeDefined();

    view.rerender(
      <ChatView {...view.props} open={openSession({ ...summary, title: undefined })} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Новая сессия" })).toBeDefined();
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
    const firstSubmit = vi.fn(() => new Promise<string | undefined>(() => undefined));
    const secondSubmit = vi.fn(() => new Promise<string | undefined>(() => undefined));
    render(
      <>
        <ChatView {...chatProps(openSession(summary), { onSubmit: firstSubmit })} />
        <ChatView
          {...chatProps(
            openSession({
              ...summary,
              id: "0299",
              title: "Вторая сессия",
              thinkingLevel: "low",
            }),
            { onSubmit: secondSubmit },
          )}
        />
      </>,
    );
    const first = screen.getByRole("heading", { name: "План релиза" }).closest("section")!;
    const second = screen.getByRole("heading", { name: "Вторая сессия" }).closest("section")!;

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

    expect(firstSubmit).toHaveBeenCalledWith({
      text: "первая панель",
      model: "google/gemini-2.5-pro",
      thinkingLevel: "max",
    });
    expect(secondSubmit).toHaveBeenCalledWith({
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

  it("keeps a busy model choice for the next idle submit without starting a turn", () => {
    const onSubmit = vi.fn(() => new Promise<string | undefined>(() => undefined));
    const busySummary = { ...summary, phase: "turn" as const };
    const view = show(openSession(busySummary), { onSubmit });

    chooseModel(view.container, "Google", /google\/gemini-2\.5-pro/);
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "следующий турн" },
    });
    expect(onSubmit).not.toHaveBeenCalled();

    view.rerender(<ChatView {...view.props} open={openSession(summary)} />);
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onSubmit).toHaveBeenCalledWith({
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
      ).toBe("true"),
    );

    view.rerender(<ChatView {...view.props} models={{}} />);
    expect(screen.getByRole("button", { name: /\/.*·/i }).getAttribute("aria-disabled")).toBe(
      "false",
    );
  });

  it("hydrates next-turn overrides when the first summary arrives for the open session", () => {
    const view = show(openSession(undefined));

    view.rerender(<ChatView {...view.props} open={openSession(summary)} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "привет" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(view.onSubmit).toHaveBeenCalledWith({
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
      <ChatView {...view.props} open={openSession({ ...summary, thinkingLevel: "medium" })} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "сохрани выбор" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(view.onSubmit).toHaveBeenCalledWith({
      text: "сохрани выбор",
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
    });
  });
});
