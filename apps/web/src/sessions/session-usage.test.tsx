// @vitest-environment jsdom

import type { SessionContextUsage, SessionStats } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { contextTone, SessionUsage } from "./session-usage.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const context = (overrides: Partial<SessionContextUsage> = {}): SessionContextUsage => ({
  sessionId: "0199",
  tokens: 700,
  contextWindow: 1000,
  threshold: 0.8,
  ...overrides,
});

const stats = (overrides: Partial<SessionStats> = {}): SessionStats => ({
  sessionId: "0199",
  messageCount: 3,
  cachedTokens: 120,
  uncachedTokens: 580,
  totalTokens: 700,
  costTotal: 0.1234,
  ...overrides,
});

describe("contextTone", () => {
  it("keeps context below its threshold accented", () => {
    expect(contextTone(context())).toBe("accent");
  });

  it("warns exactly at the configured threshold", () => {
    expect(contextTone(context({ tokens: 800 }))).toBe("warning");
  });

  it("marks a full context window as dangerous", () => {
    expect(contextTone(context({ tokens: 1000 }))).toBe("danger");
  });

  it.each([0, 1, 1.5])("uses an 80 percent warning fallback for threshold %s", (threshold) => {
    expect(contextTone(context({ tokens: 800, threshold }))).toBe("warning");
  });
});

describe("SessionUsage", () => {
  it("keeps context, session tokens, and cost as independent metric groups", () => {
    render(
      <SessionUsage context={context({ tokens: 800 })} stats={stats()} translator={translator} />,
    );

    const contextGroup = screen.getByRole("group", { name: "Контекст" });
    const tokensGroup = screen.getByRole("group", { name: "Токены сессии" });
    const costGroup = screen.getByRole("group", { name: "Стоимость" });

    expect(within(contextGroup).getByText("800 / 1000 · 80%")).toBeTruthy();
    expect(within(contextGroup).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("80");
    expect(within(tokensGroup).getByText("700")).toBeTruthy();
    expect(within(costGroup).getByText("$0.1234")).toBeTruthy();
  });

  it("shows unavailable values as a dash", () => {
    render(<SessionUsage context={undefined} stats={undefined} translator={translator} />);

    expect(within(screen.getByRole("group", { name: "Контекст" })).getByText("—")).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Токены сессии" })).getByText("—"),
    ).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Стоимость" })).getByText("—")).toBeTruthy();
  });

  it("does not invent a progress bar or percentage for an unknown context window", () => {
    render(
      <SessionUsage
        context={context({ contextWindow: undefined })}
        stats={stats()}
        translator={translator}
      />,
    );

    const contextGroup = screen.getByRole("group", { name: "Контекст" });

    expect(within(contextGroup).getByText("700 / окно неизвестно")).toBeTruthy();
    expect(within(contextGroup).queryByRole("progressbar")).toBeNull();
    expect(contextGroup.textContent).not.toContain("%");
  });
});
