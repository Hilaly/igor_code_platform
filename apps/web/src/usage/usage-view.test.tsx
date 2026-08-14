// @vitest-environment jsdom

import type { Session, SessionStats } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { UsageState } from "./usage-state.ts";
import { UsageView } from "./usage-view.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "en",
  namespace: coreNamespace,
  catalogs: [coreEnglish],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const session = (id: string, title: string | undefined, archived = false): Session => ({
  id,
  projectId: "project-alpha",
  folder: "/workspace/alpha",
  agentId: "default",
  agentAvailable: true,
  model: "provider/model",
  thinkingLevel: "medium",
  phase: "idle",
  title,
  archived,
  hidden: false,
  createdAt: "2026-08-08T12:00:00.000Z",
});

const stats = (sessionId: string, totalTokens: number, costTotal: number): SessionStats => ({
  sessionId,
  messageCount: 2,
  cachedTokens: 30,
  uncachedTokens: totalTokens - 30,
  totalTokens,
  costTotal,
});

describe("UsageView", () => {
  it("distinguishes loading, failure and exact empty states", () => {
    const view = render(<UsageView state={{ status: "loading" }} translator={translator} />);
    expect(screen.getByRole("status").textContent).toBe("Loading usage…");

    view.rerender(
      <UsageView
        state={{ status: "failed", failure: "connection refused" }}
        translator={translator}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("connection refused");

    view.rerender(
      <UsageView
        state={{
          status: "ready",
          snapshot: { catalogComplete: true, listedSessionCount: 0, records: [], problems: [] },
        }}
        translator={translator}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("No usage recorded yet");
  });

  it("renders exact totals, a per-session bar chart and a readable data table", () => {
    const state: UsageState = {
      status: "ready",
      snapshot: {
        catalogComplete: true,
        listedSessionCount: 2,
        problems: [],
        records: [
          { session: session("alpha", "Alpha"), stats: stats("alpha", 100, 0.25) },
          { session: session("beta", undefined, true), stats: stats("beta", 200, 0.75) },
        ],
      },
    };

    render(<UsageView state={state} translator={translator} />);

    const totals = screen.getByRole("region", { name: "Exact totals" });
    expect(
      within(totals).getByRole("group", { name: "Sessions with statistics" }).textContent,
    ).toContain("2");
    expect(within(totals).getByRole("group", { name: "Tokens" }).textContent).toContain("300");
    expect(within(totals).getByRole("group", { name: "Cost" }).textContent).toContain("$1.0000");

    const chart = screen.getByRole("list", { name: "Tokens by session" });
    expect(within(chart).getAllByRole("listitem")).toHaveLength(2);
    expect(within(chart).getByText("Alpha")).toBeTruthy();
    expect(within(chart).getByText("beta")).toBeTruthy();

    const table = screen.getByRole("table", { name: "Exact usage by session" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("columnheader", { name: "Cached tokens" })).toBeTruthy();
    expect(within(table).getByText("Archived")).toBeTruthy();
  });

  it("labels partial data and lists every unavailable exact statistic", () => {
    render(
      <UsageView
        state={{
          status: "ready",
          snapshot: {
            catalogComplete: true,
            listedSessionCount: 2,
            records: [{ session: session("alpha", "Alpha"), stats: stats("alpha", 100, 0.25) }],
            problems: ["beta: cannot read stats"],
          },
        }}
        translator={translator}
      />,
    );

    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("Statistics loaded for 1 of 2 sessions");
    expect(within(warning).getByText("beta: cannot read stats")).toBeTruthy();
  });

  it("shows catalog problems instead of claiming an empty exact data set", () => {
    render(
      <UsageView
        state={{
          status: "ready",
          snapshot: {
            catalogComplete: false,
            listedSessionCount: 0,
            records: [],
            problems: ["the session file is unreadable"],
          },
        }}
        translator={translator}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Some exact usage is unavailable");
    expect(screen.getByRole("status").textContent).toBe("No exact statistics are available");
    expect(screen.queryByText("No usage recorded yet")).toBeNull();
  });
});
