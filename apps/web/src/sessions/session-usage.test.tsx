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
  it("keeps context and session statistics in two tooltip sections", () => {
    render(
      <SessionUsage context={context({ tokens: 190 })} stats={stats()} translator={translator} />,
    );

    const progress = screen.getByRole("progressbar", { name: "Заполнение контекста" });
    const tooltip = screen.getByRole("tooltip");
    expect(progress.tagName).toBe("svg");
    expect(progress.getAttribute("aria-valuenow")).toBe("19");
    expect(progress.getAttribute("tabindex")).toBe("0");
    expect(progress.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(within(tooltip).getByText("Контекстное окно")).toBeTruthy();
    expect(within(tooltip).getByText("19% использовано · 81% осталось")).toBeTruthy();
    expect(within(tooltip).getByText("190 / 1000 токенов")).toBeTruthy();
    expect(within(tooltip).getByText("Статистика сессии")).toBeTruthy();
    expect(within(tooltip).getByText("Токенов: 700")).toBeTruthy();
    expect(within(tooltip).getByText("Стоимость: $0.1234")).toBeTruthy();
    expect(tooltip.querySelector("hr")).not.toBeNull();
  });

  it("keeps the compact indicator present when usage is unavailable", () => {
    render(<SessionUsage context={undefined} stats={undefined} translator={translator} />);

    const progress = screen.getByRole("progressbar", { name: "Заполнение контекста" });
    const tooltip = screen.getByRole("tooltip");
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(tooltip.textContent).toContain("Контекстное окно");
    expect(tooltip.textContent).toContain("Токенов: —");
    expect(tooltip.textContent).toContain("Стоимость: —");
  });

  it("does not invent a percentage for an unknown context window", () => {
    render(
      <SessionUsage
        context={context({ contextWindow: undefined })}
        stats={stats()}
        translator={translator}
      />,
    );

    const progress = screen.getByRole("progressbar", { name: "Заполнение контекста" });
    const tooltip = screen.getByRole("tooltip");
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(within(tooltip).getByText("700 / окно неизвестно")).toBeTruthy();
    expect(tooltip.textContent).not.toContain("%");
  });
});
