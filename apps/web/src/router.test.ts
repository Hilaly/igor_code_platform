import { describe, expect, it } from "vitest";

import { matchLocation, matchPage, pathOf, urlOf } from "./router.ts";

describe("matchPage", () => {
  it("opens an administrative plugin detail from an encoded plugin key", () => {
    expect(matchPage("/settings/plugins/data%3Ausage")).toEqual({
      kind: "settings-plugin",
      pluginKey: "data:usage",
    });
  });

  it("round-trips plugin keys that look like path navigation", () => {
    const page = { kind: "settings-plugin" as const, pluginKey: ".." };

    expect(matchPage(pathOf(page))).toEqual(page);
  });

  it("keeps the plugin list at its section route", () => {
    expect(matchPage("/settings/plugins")).toEqual({ kind: "settings", section: "plugins" });
  });
  it("takes the root for the home page", () => {
    expect(matchPage("/")).toEqual({ kind: "home" });
    expect(matchPage("")).toEqual({ kind: "home" });
  });

  it("moves plugin management into settings", () => {
    expect(matchPage("/plugins")).toEqual({ kind: "settings", section: "plugins" });
    expect(matchPage("/settings/plugins")).toEqual({ kind: "settings", section: "plugins" });
    // Вложенного у вью плагинов нет: адрес глубже — не она.
    expect(matchPage("/plugins/hello")).toEqual({ kind: "unknown", path: "/plugins/hello" });
  });

  it("keeps project management inside settings and drops the old addresses", () => {
    expect(matchPage("/settings/projects")).toEqual({ kind: "settings", section: "projects" });
    expect(matchPage("/settings/projects/b7Kq3xv9pQdT")).toEqual({
      kind: "settings-project",
      projectId: "b7Kq3xv9pQdT",
    });
    expect(pathOf({ kind: "settings", section: "projects" })).toBe("/settings/projects");
    expect(pathOf({ kind: "settings-project", projectId: "b7Kq3xv9pQdT" })).toBe(
      "/settings/projects/b7Kq3xv9pQdT",
    );
    expect(matchPage("/projects")).toEqual({ kind: "unknown", path: "/projects" });
    expect(matchPage("/projects/b7Kq3xv9pQdT")).toEqual({
      kind: "unknown",
      path: "/projects/b7Kq3xv9pQdT",
    });
  });

  it("moves providers and provider details into settings", () => {
    expect(matchPage("/providers")).toEqual({ kind: "settings", section: "providers" });
    // Страница одного провайдера: вход и модели живут здесь, а не в раскрывающейся панели списка.
    expect(matchPage("/providers/anthropic")).toEqual({
      kind: "settings",
      section: "providers",
      providerId: "anthropic",
    });
    // Идентификатор не проверяется форматом — «нет такого» скажет вью по снимку, а не маршрут.
    expect(matchPage("/providers/нет-такого")).toEqual({
      kind: "settings",
      section: "providers",
      providerId: "нет-такого",
    });
    expect(matchPage("/settings/providers/anthropic")).toEqual({
      kind: "settings",
      section: "providers",
      providerId: "anthropic",
    });
  });

  it("gives user provider creation and editing separate canonical pages", () => {
    expect(matchPage("/settings/providers/new")).toEqual({ kind: "new-provider" });
    expect(matchPage("/settings/providers/vendor-local/edit")).toEqual({
      kind: "edit-provider",
      providerId: "vendor-local",
    });
    expect(matchPage("/providers/new")).toEqual({ kind: "new-provider" });
    expect(matchPage("/providers/vendor-local/edit")).toEqual({
      kind: "edit-provider",
      providerId: "vendor-local",
    });
    expect(pathOf({ kind: "new-provider" })).toBe("/settings/providers/new");
    expect(pathOf({ kind: "edit-provider", providerId: "vendor-local" })).toBe(
      "/settings/providers/vendor-local/edit",
    );
  });

  it("keeps a single session on an address of its own", () => {
    expect(matchPage("/sessions")).toEqual({ kind: "home" });
    expect(matchPage("/sessions/0199abcd-ef01")).toEqual({
      kind: "session",
      sessionId: "0199abcd-ef01",
    });
  });

  it("routes archived sessions before the identifier check", () => {
    expect(matchPage("/sessions/archive")).toEqual({ kind: "session-archive" });
  });

  it("routes the session creation to its own address before the identifier check", () => {
    // Строка "new" проходит регекс `isSessionId`, но означает экран создания, а не идентификатор.
    expect(matchPage("/sessions/new")).toEqual({ kind: "new-session" });
    expect(matchPage("/sessions/new/deeper")).toEqual({
      kind: "unknown",
      path: "/sessions/new/deeper",
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

  it("takes bare settings for appearance", () => {
    expect(matchPage("/settings")).toEqual({ kind: "settings", section: "appearance" });
    expect(pathOf(matchPage("/settings"))).toBe("/settings/appearance");
    expect(matchPage("/settings/appearance")).toEqual({
      kind: "settings",
      section: "appearance",
    });
  });

  it("addresses exact usage analytics as a settings section", () => {
    expect(matchPage("/settings/usage")).toEqual({ kind: "settings", section: "usage" });
    expect(pathOf({ kind: "settings", section: "usage" })).toBe("/settings/usage");
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
    const page = {
      kind: "settings",
      section: "providers",
      providerId: "vendor/модель с пробелом",
    } as const;

    const path = pathOf(page);

    expect(path).toBe(
      "/settings/providers/vendor%2F%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D1%8C%20%D1%81%20%D0%BF%D1%80%D0%BE%D0%B1%D0%B5%D0%BB%D0%BE%D0%BC",
    );
    expect(matchPage(path)).toEqual(page);
  });

  it("takes malformed percent encoding for an unknown address", () => {
    expect(() => matchPage("/providers/%")).not.toThrow();
    expect(matchPage("/providers/%")).toEqual({ kind: "unknown", path: "/providers/%" });
  });

  it.each([
    ["", "rival", "/p/~%2E%2E%2E/rival"],
    ["rival", "", "/p/rival/~%2E%2E%2E"],
    [".", "..", "/p/~%2E/~%2E%2E"],
    ["..", ".", "/p/~%2E%2E/~%2E"],
    ["rival/child", "board/child", "/p/rival%2Fchild/board%2Fchild"],
    ["rival\\child", "board\\child", "/p/rival%5Cchild/board%5Cchild"],
    ["%2e%2e", "%2F%5C", "/p/%252e%252e/%252F%255C"],
  ])("round-trips opaque plugin page identifiers %s and %s", (pluginId, pageId, path) => {
    const page = { kind: "plugin" as const, pluginId, pageId, rest: "" };

    expect(pathOf(page)).toBe(path);
    expect(matchPage(path)).toEqual(page);
  });

  it("takes malformed percent encoding in a plugin page identifier for an unknown address", () => {
    expect(matchPage("/p/%/board")).toEqual({ kind: "unknown", path: "/p/%/board" });
    expect(matchPage("/p/rival/%")).toEqual({ kind: "unknown", path: "/p/rival/%" });
  });

  it("survives a round trip", () => {
    for (const path of [
      "/",
      "/settings/projects",
      "/settings/projects/b7Kq3xv9pQdT",
      "/sessions/new",
      "/sessions/archive",
      "/sessions/0199abcd-ef01",
      "/settings/appearance",
      "/settings/usage",
      "/settings/providers",
      "/settings/providers/anthropic",
      "/settings/plugins",
      "/p/tracker/board",
      "/p/tracker/board/15/edit",
      "/nowhere",
    ]) {
      expect(pathOf(matchPage(path))).toBe(path === "" ? "/" : path);
    }
  });
});

describe("matchLocation", () => {
  it("reads the parameters next to the page, not inside it", () => {
    expect(matchLocation("/p/tracker/board/15?filter=warn&sort=age")).toEqual({
      page: { kind: "plugin", pluginId: "tracker", pageId: "board", rest: "15" },
      query: { filter: "warn", sort: "age" },
    });
  });

  it("gives an address without parameters an empty set of them", () => {
    expect(matchLocation("/settings/plugins").query).toEqual({});
  });

  /** Якорь маршруту не принадлежит вовсе: он адресует место внутри страницы, а не страницу. */
  it("ignores the fragment", () => {
    expect(matchLocation("/p/tracker/board?tab=open#row-3")).toEqual({
      page: { kind: "plugin", pluginId: "tracker", pageId: "board", rest: "" },
      query: { tab: "open" },
    });
  });

  /** Записанное ограничение: повторяющийся ключ теряет всё, кроме последнего значения. */
  it("keeps the last value of a repeated key", () => {
    expect(matchLocation("/p/tracker/board?tag=a&tag=b").query).toEqual({ tag: "b" });
  });
});

describe("urlOf", () => {
  it("leaves an address without parameters without a question mark", () => {
    expect(urlOf({ page: { kind: "home" }, query: {} })).toBe("/");
  });

  it("survives a round trip together with its parameters", () => {
    for (const url of [
      "/p/tracker/board?filter=warn",
      "/p/tracker/board/15/edit?filter=warn&sort=age",
      "/settings/plugins",
      "/p/tracker/board?query=%D1%80%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9",
    ]) {
      expect(urlOf(matchLocation(url))).toBe(url);
    }
  });
});
