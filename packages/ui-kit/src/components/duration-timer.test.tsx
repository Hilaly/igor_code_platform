// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DurationTimer } from "./duration-timer.tsx";

const labels = {
  days: "days",
  hours: "hours",
  minutes: "minutes",
  seconds: "seconds",
};

afterEach(cleanup);

describe("DurationTimer", () => {
  it("renders a zero-padded clock and omits the zero-day group", () => {
    render(
      <DurationTimer
        totalSeconds={3_661}
        labels={labels}
        accessibleLabel="1 hour 1 minute 1 second"
      />,
    );

    const timer = screen.getByRole("group", { name: "1 hour 1 minute 1 second" });

    expect(within(timer).getAllByText("01")).toHaveLength(3);
    expect(within(timer).getAllByText(":")).toHaveLength(2);
    expect(within(timer).queryByText("days")).toBeNull();
    expect(within(timer).getByText("hours")).toBeTruthy();
    expect(within(timer).getByText("minutes")).toBeTruthy();
    expect(within(timer).getByText("seconds")).toBeTruthy();
  });

  it("renders whole days before the zero-padded clock", () => {
    render(
      <DurationTimer
        totalSeconds={176_461}
        labels={labels}
        accessibleLabel="2 days 1 hour 1 minute 1 second"
      />,
    );

    const timer = screen.getByRole("group", {
      name: "2 days 1 hour 1 minute 1 second",
    });

    expect(within(timer).getByText("2")).toBeTruthy();
    expect(within(timer).getByText("days")).toBeTruthy();
    expect(within(timer).getAllByText("01")).toHaveLength(3);
  });

  it("is a named static group rather than an aria live region", () => {
    render(<DurationTimer totalSeconds={0} labels={labels} accessibleLabel="0 seconds" />);

    const timer = screen.getByRole("group", { name: "0 seconds" });

    expect(timer.getAttribute("aria-live")).toBeNull();
  });
});
