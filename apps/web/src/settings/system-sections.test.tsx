// @vitest-environment jsdom

import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DaemonSection } from "./daemon-section.tsx";
import { DiagnosticsSection } from "./diagnostics-section.tsx";

const translator = createTranslator({
  locale: "en",
  namespace: coreNamespace,
  catalogs: [coreEnglish],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-07T12:30:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("lays daemon facts out as compact Appearance-style property rows and ticks uptime", () => {
  const { unmount } = render(
    <DaemonSection
      stream="open"
      health={{ status: "ok", startedAt: "2026-08-07T12:00:00.000Z", uptimeSeconds: 1_800 }}
      failure={undefined}
      locale="en-GB"
      translator={translator}
    />,
  );

  const daemon = screen.getByRole("group", { name: "Connection" }).parentElement;
  const rows = Array.from(daemon?.children ?? []).filter(
    (child) => child.getAttribute("role") === "group",
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]?.getAttribute("aria-label")).toBe("Connection");

  const uptime = screen.getByRole("group", { name: "Uptime" });
  expect(within(uptime).getByText(/^Started: 7 Aug 2026, \d{2}:00$/)).toBeTruthy();
  const timer = within(uptime).getByRole("group", { name: "up 30m 0s" });
  expect(within(timer).getAllByText("00")).toHaveLength(2);
  expect(within(timer).getByText("30")).toBeTruthy();
  expect(within(timer).getAllByText(":")).toHaveLength(2);

  act(() => vi.advanceTimersByTime(1_000));

  const tickedTimer = within(uptime).getByRole("group", { name: "up 30m 1s" });
  expect(within(tickedTimer).getByText("01")).toBeTruthy();
  expect(vi.getTimerCount()).toBe(1);

  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps daemon loading and failure states in the uptime value column", () => {
  const view = render(
    <DaemonSection
      stream="connecting"
      health={undefined}
      failure={undefined}
      locale="en-GB"
      translator={translator}
    />,
  );

  const uptime = screen.getByRole("group", { name: "Uptime" });
  expect(within(uptime).getByText("Loading…")).toBeTruthy();
  expect(within(uptime).queryByRole("group", { name: /^up / })).toBeNull();

  view.rerender(
    <DaemonSection
      stream="reconnecting"
      health={undefined}
      failure="connection refused"
      locale="en-GB"
      translator={translator}
    />,
  );

  expect(within(uptime).getByText("Unreachable: connection refused")).toBeTruthy();
  expect(within(uptime).queryByText("Loading…")).toBeNull();
});

it("keeps every visible uptime unit in the accessible timer name after an hour", () => {
  render(
    <DaemonSection
      stream="open"
      health={{ status: "ok", startedAt: "2026-08-07T11:29:59.000Z", uptimeSeconds: 3_601 }}
      failure={undefined}
      locale="en-GB"
      translator={translator}
    />,
  );

  const uptime = screen.getByRole("group", { name: "Uptime" });
  expect(within(uptime).getByRole("group", { name: "up 1h 0m 1s" })).toBeTruthy();

  act(() => vi.advanceTimersByTime(1_000));

  expect(within(uptime).getByRole("group", { name: "up 1h 0m 2s" })).toBeTruthy();
});

it("renders diagnostics as a named flat technical stream", () => {
  render(
    <DiagnosticsSection
      diagnostics={[
        { index: 2, text: "event stream reconnected" },
        { index: 1, text: "preferences.json was repaired" },
      ]}
      translator={translator}
    />,
  );

  const stream = screen.getByRole("list", { name: "Diagnostics" });
  expect(stream.tagName).toBe("OL");
  expect(within(stream).getAllByRole("listitem")).toHaveLength(2);
  expect(within(stream).getByText("event stream reconnected").tagName).toBe("CODE");
  expect(within(stream).getByText("preferences.json was repaired").tagName).toBe("CODE");
});

it("keeps an empty diagnostics state inline with the flat stream", () => {
  render(<DiagnosticsSection diagnostics={[]} translator={translator} />);

  expect(screen.getByRole("status").textContent).toBe("Nothing to report");
  expect(screen.queryByRole("list")).toBeNull();
});

it("divides diagnostic entries without cards or rounded frames", () => {
  const styles = readFileSync(join(import.meta.dirname, "settings.css"), "utf8");

  expect(styles).toMatch(
    /\.settings-diagnostics-stream\s*>\s*li\s*\{[^}]*border-block-end:\s*var\(--sovereign-stroke-thin\) solid var\(--sovereign-border-subtle\);/s,
  );
  expect(styles).not.toMatch(
    /\.settings-diagnostics-(?:stream|empty)[^{]*\{[^}]*(?:border-radius|box-shadow|background)\s*:/s,
  );
});
