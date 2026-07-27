import { describe, expect, it } from "vitest";

import { matchPage, pathOf } from "./router.ts";

describe("matchPage", () => {
  it("takes the root for the home page", () => {
    expect(matchPage("/")).toEqual({ kind: "home" });
    expect(matchPage("")).toEqual({ kind: "home" });
  });

  it("reads the plugin page namespace", () => {
    expect(matchPage("/p/tracker/board")).toEqual({
      kind: "plugin",
      pluginId: "tracker",
      pageId: "board",
      rest: "",
    });
    expect(matchPage("/p/tracker/board/15/edit")).toEqual({
      kind: "plugin",
      pluginId: "tracker",
      pageId: "board",
      rest: "15/edit",
    });
  });

  it("takes half a plugin address for nothing at all", () => {
    expect(matchPage("/p/tracker")).toEqual({ kind: "unknown", path: "/p/tracker" });
    expect(matchPage("/p")).toEqual({ kind: "unknown", path: "/p" });
  });

  it("gives back an unknown address as it came", () => {
    expect(matchPage("/settings")).toEqual({ kind: "unknown", path: "/settings" });
  });
});

describe("pathOf", () => {
  it("survives a round trip", () => {
    for (const path of ["/", "/p/tracker/board", "/p/tracker/board/15/edit", "/settings"]) {
      expect(pathOf(matchPage(path))).toBe(path === "" ? "/" : path);
    }
  });
});
