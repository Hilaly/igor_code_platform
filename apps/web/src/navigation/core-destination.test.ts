import { describe, expect, it } from "vitest";

import { urlOf } from "../router.ts";
import { locationOfDestination } from "./core-destination.ts";

describe("locationOfDestination", () => {
  /** Плагин называет адрес, а не строит его: форма пути остаётся внутренним делом `apps/web`. */
  it.each([
    [{ kind: "home" } as const, "/"],
    [{ kind: "new-session" } as const, "/sessions/new"],
    [{ kind: "session-archive" } as const, "/sessions/archive"],
    [{ kind: "session", sessionId: "0199abcd-ef01" } as const, "/sessions/0199abcd-ef01"],
    [{ kind: "settings", section: "plugins" } as const, "/settings/plugins"],
    [{ kind: "plugin-page", pluginId: "rival", pageId: "board" } as const, "/p/rival/board"],
  ])("turns %o into %s", (destination, url) => {
    expect(urlOf(locationOfDestination(destination))).toBe(url);
  });

  it("carries the path and the parameters of another plugin page", () => {
    const url = urlOf(
      locationOfDestination({
        kind: "plugin-page",
        pluginId: "rival",
        pageId: "board",
        path: "/entry/3",
        query: { filter: "warn" },
      }),
    );

    expect(url).toBe("/p/rival/board/entry/3?filter=warn");
  });

  it.each(["../../../settings/plugins", "/%2e%2e/%2e%2e/settings/plugins"])(
    "keeps another plugin page path inside its page for %s",
    (path) => {
      const url = urlOf(
        locationOfDestination({
          kind: "plugin-page",
          pluginId: "rival",
          pageId: "board",
          path,
        }),
      );

      expect(url).toBe("/p/rival/board/settings/plugins");
    },
  );
});
