// @vitest-environment jsdom

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AgentActivity } from "./agent-activity.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

it.each(["queued", "turn", "compaction", "branch-summary", "retry"] as const)(
  "shows the %s phase outside idle",
  (phase) => {
    render(
      <AgentActivity sessionId="0199" phase={phase} totalTokens={11_000} translator={translator} />,
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toContain(translator.t(`sessions.phase.${phase}`));
    expect(status.textContent).toContain(
      translator.t("chat.activity.tokens", {
        total: translator.formatNumber(11_000, {
          notation: "compact",
          maximumFractionDigits: 1,
        }),
      }),
    );
    expect(status.getAttribute("aria-live")).toBe("off");
  },
);

it("renders nothing in idle and omits an unknown token total", () => {
  const view = render(<AgentActivity sessionId="0199" phase="idle" translator={translator} />);
  expect(screen.queryByRole("status")).toBeNull();

  view.rerender(<AgentActivity sessionId="0199" phase="turn" translator={translator} />);
  expect(screen.getByRole("status").textContent).not.toContain("токен");
});

it("keeps one clock across busy phases and resets it after idle or a session change", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T10:00:00.000Z"));
  const view = render(
    <AgentActivity sessionId="0199" phase="queued" totalTokens={11_000} translator={translator} />,
  );

  act(() => vi.advanceTimersByTime(53_000));
  expect(screen.getByRole("status").textContent).toContain("53 с");

  view.rerender(
    <AgentActivity sessionId="0199" phase="retry" totalTokens={11_000} translator={translator} />,
  );
  expect(screen.getByRole("status").textContent).toContain("53 с");

  view.rerender(
    <AgentActivity sessionId="0199" phase="idle" totalTokens={11_000} translator={translator} />,
  );
  expect(screen.queryByRole("status")).toBeNull();

  view.rerender(
    <AgentActivity sessionId="0199" phase="turn" totalTokens={11_000} translator={translator} />,
  );
  expect(screen.getByRole("status").textContent).toContain("0 с");

  act(() => vi.advanceTimersByTime(8_000));
  view.rerender(
    <AgentActivity sessionId="0200" phase="turn" totalTokens={200} translator={translator} />,
  );
  expect(screen.getByRole("status").textContent).toContain("0 с");
});
