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

  it("keeps the providers on their own address, with an optional provider page", () => {
    expect(matchPage("/providers")).toEqual({ kind: "providers" });
    // Страница одного провайдера: вход и модели живут здесь, а не в раскрывающейся панели списка.
    expect(matchPage("/providers/anthropic")).toEqual({
      kind: "providers",
      providerId: "anthropic",
    });
    // Идентификатор не проверяется форматом — «нет такого» скажет вью по снимку, а не маршрут.
    expect(matchPage("/providers/нет-такого")).toEqual({
      kind: "providers",
      providerId: "нет-такого",
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

  it("keeps the settings on their own address, with an optional section", () => {
    expect(matchPage("/settings")).toEqual({ kind: "settings" });
    expect(matchPage("/settings/appearance")).toEqual({
      kind: "settings",
      section: "appearance",
    });
  });

  it("takes an unknown settings section for an unknown address", () => {
    // Список разделов закрыт: раздел, которого ядро не знает, не превращается в запрос.
    expect(matchPage("/settings/нет-такого")).toEqual({
      kind: "unknown",
      path: "/settings/нет-такого",
    });
  });

  it("gives back an unknown address as it came", () => {
    expect(matchPage("/nowhere")).toEqual({ kind: "unknown", path: "/nowhere" });
  });
});

describe("pathOf", () => {
  it("round-trips an opaque provider identifier through one URL segment", () => {
    const page = { kind: "providers", providerId: "vendor/модель с пробелом" } as const;

    const path = pathOf(page);

    expect(path).toBe(
      "/providers/vendor%2F%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C%20%D1%81%20%D0%BF%D1%80%D0%BE%D0%B1%D0%B5%D0%BB%D0%BE%D0%BC",
    );
    expect(matchPage(path)).toEqual(page);
  });

  it("takes malformed percent encoding for an unknown address", () => {
    expect(() => matchPage("/providers/%")).not.toThrow();
    expect(matchPage("/providers/%")).toEqual({ kind: "unknown", path: "/providers/%" });
  });

  it("survives a round trip", () => {
    for (const path of [
      "/",
      "/plugins",
      "/projects",
      "/providers",
      "/providers/anthropic",
      "/sessions",
      "/sessions/0199abcd-ef01",
      "/settings",
      "/settings/appearance",
      "/p/tracker/board",
      "/p/tracker/board/15/edit",
      "/nowhere",
    ]) {
      expect(pathOf(matchPage(path))).toBe(path === "" ? "/" : path);
    }
  });
});
