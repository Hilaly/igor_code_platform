import { describe, expect, it } from "vitest";

import { matchPage, pathOf } from "./router.ts";

describe("matchPage", () => {
  it("takes the root for the home page", () => {
    expect(matchPage("/")).toEqual({ kind: "home" });
    expect(matchPage("")).toEqual({ kind: "home" });
  });

  it("keeps the plugin management on its own address", () => {
    expect(matchPage("/plugins")).toEqual({ kind: "plugins" });
    // Вложенного у вью плагинов нет: адрес глубже — не она.
    expect(matchPage("/plugins/hello")).toEqual({ kind: "unknown", path: "/plugins/hello" });
  });

  it("keeps the projects on their own address", () => {
    expect(matchPage("/projects")).toEqual({ kind: "projects" });
    expect(matchPage("/projects/b7Kq3xv9pQdT")).toEqual({
      kind: "unknown",
      path: "/projects/b7Kq3xv9pQdT",
    });
  });

  it("keeps the providers on their own address", () => {
    expect(matchPage("/providers")).toEqual({ kind: "providers" });
    // Провайдер своей страницы не получает: модели раскрываются внутри вью, а не по адресу.
    expect(matchPage("/providers/anthropic")).toEqual({
      kind: "unknown",
      path: "/providers/anthropic",
    });
  });

  it("keeps a single session on an address of its own", () => {
    expect(matchPage("/sessions")).toEqual({ kind: "sessions" });
    expect(matchPage("/sessions/0199abcd-ef01")).toEqual({
      kind: "sessions",
      sessionId: "0199abcd-ef01",
    });
  });

  it("takes a malformed session identifier for an unknown address", () => {
    // Мусор в адресе не должен превращаться в запрос, который вернёт 404: проверка та же, что у демона.
    expect(matchPage("/sessions/со слэшем/ещё")).toEqual({
      kind: "unknown",
      path: "/sessions/со слэшем/ещё",
    });
    expect(matchPage("/sessions/русскими буквами")).toEqual({
      kind: "unknown",
      path: "/sessions/русскими буквами",
    });
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
    for (const path of [
      "/",
      "/plugins",
      "/projects",
      "/providers",
      "/sessions",
      "/sessions/0199abcd-ef01",
      "/p/tracker/board",
      "/p/tracker/board/15/edit",
      "/settings",
    ]) {
      expect(pathOf(matchPage(path))).toBe(path === "" ? "/" : path);
    }
  });
});
