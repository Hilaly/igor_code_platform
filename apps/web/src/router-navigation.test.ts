// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { createNavigation } from "./router.ts";

beforeEach(() => {
  window.history.replaceState(undefined, "", "/");
});

describe("provider navigation in a browser", () => {
  it.each([".", "..", "~.", "~.."])(
    'round-trips the opaque provider identifier "%s"',
    (providerId) => {
      const navigation = createNavigation(window);

      navigation.navigate({ kind: "settings", section: "providers", providerId });

      expect(navigation.current()).toEqual({ kind: "settings", section: "providers", providerId });
    },
  );

  it.each([
    ["/sessions", "/", { kind: "home" }],
    ["/settings", "/settings/appearance", { kind: "settings", section: "appearance" }],
    ["/plugins", "/settings/plugins", { kind: "settings", section: "plugins" }],
    ["/settings/projects", "/settings/projects", { kind: "settings", section: "projects" }],
    [
      "/settings/projects/alpha",
      "/settings/projects/alpha",
      { kind: "settings-project", projectId: "alpha" },
    ],
    ["/providers", "/settings/providers", { kind: "settings", section: "providers" }],
    [
      "/providers/anthropic",
      "/settings/providers/anthropic",
      { kind: "settings", section: "providers", providerId: "anthropic" },
    ],
  ] as const)("replaces legacy address %s with %s", (legacy, canonical, page) => {
    window.history.replaceState(undefined, "", legacy);
    const navigation = createNavigation(window);

    expect(navigation.current()).toEqual(page);
    expect(window.location.pathname).toBe(canonical);
  });
});
