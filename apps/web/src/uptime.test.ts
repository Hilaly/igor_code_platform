import { describe, expect, it } from "vitest";

import { formatUptime } from "./uptime.ts";

describe("formatUptime", () => {
  it("shows seconds under a minute", () => {
    expect(formatUptime(42)).toBe("42 с");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatUptime(90)).toBe("1 мин 30 с");
  });

  it("drops seconds once there are hours", () => {
    expect(formatUptime(3 * 3600 + 5 * 60 + 7)).toBe("3 ч 5 мин");
  });
});
