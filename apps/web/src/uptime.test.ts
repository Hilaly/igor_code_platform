import { describe, expect, it } from "vitest";

import { formatUptime, type DurationUnits } from "./uptime.ts";

/** Русские единицы, как их отдал бы каталог ядра: формат не должен зависеть от языка. */
const russian: DurationUnits = {
  hours: (count) => `${count} ч`,
  minutes: (count) => `${count} мин`,
  seconds: (count) => `${count} с`,
};

const english: DurationUnits = {
  hours: (count) => `${count}h`,
  minutes: (count) => `${count}m`,
  seconds: (count) => `${count}s`,
};

describe("formatUptime", () => {
  it("shows seconds under a minute", () => {
    expect(formatUptime(42, russian)).toBe("42 с");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatUptime(90, russian)).toBe("1 мин 30 с");
  });

  it("drops seconds once there are hours", () => {
    expect(formatUptime(3 * 3600 + 5 * 60 + 7, russian)).toBe("3 ч 5 мин");
  });

  it("says the same thing in another language", () => {
    expect(formatUptime(90, english)).toBe("1m 30s");
  });
});
