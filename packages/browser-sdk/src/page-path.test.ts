import { describe, expect, it } from "vitest";

import { normalizePagePath } from "./page-path.ts";

describe("normalizePagePath", () => {
  it.each([
    ["/entry/../log", "/log"],
    ["/%2e%2e/%2e%2e/settings", "/settings"],
    ["/.%2e/%2E./settings", "/settings"],
    ["/%252e%252e/settings", "/%252e%252e/settings"],
  ])("normalizes %s to %s without leaving the page root", (path, expected) => {
    expect(normalizePagePath(path)).toBe(expected);
  });
});
