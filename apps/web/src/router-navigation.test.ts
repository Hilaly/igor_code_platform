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

      navigation.navigate({ kind: "providers", providerId });

      expect(navigation.current()).toEqual({ kind: "providers", providerId });
    },
  );
});
