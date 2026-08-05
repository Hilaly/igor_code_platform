// @vitest-environment jsdom

import type { Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  archived: false,
  createdAt: "2026-08-05T00:00:00.000Z",
};

const openSession = (sessionSummary: Session | undefined): OpenSession => ({
  id: "0199",
  summary: sessionSummary,
  entries: [],
  seen: 0,
  pending: {},
  labels: new Map(),
  branchEntryIds: new Set(),
  degradations: [],
  loading: false,
});

const show = (open: OpenSession) => {
  const onSubmit: ChatViewProps["onSubmit"] = vi.fn(
    () => new Promise<string | undefined>(() => undefined),
  );
  const onNavigate: ChatViewProps["onNavigate"] = vi.fn(() =>
    Promise.resolve({ kind: "refused" as const, reason: "unused" }),
  );
  const props: ChatViewProps = {
    open,
    onSubmit,
    onSendMessage: vi.fn(() => Promise.resolve(undefined)),
    onInterrupt: vi.fn(),
    onFork: vi.fn(() => Promise.resolve()),
    onCompact: vi.fn(() => Promise.resolve(undefined)),
    onSetLabel: vi.fn(() => Promise.resolve(undefined)),
    onNavigate,
    translator,
  };

  return { ...render(<ChatView {...props} />), onSubmit, props };
};

describe("the session chat view", () => {
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

    fireEvent.click(screen.getByRole("combobox", { name: "Уровень рассуждений" }));
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
