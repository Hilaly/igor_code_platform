// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

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

      expect(navigation.current().page).toEqual({
        kind: "settings",
        section: "providers",
        providerId,
      });
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

    expect(navigation.current().page).toEqual(page);
    expect(window.location.pathname).toBe(canonical);
  });
});

describe("navigation by the full address", () => {
  /**
   * Предпосылка страниц плагина: переход, меняющий только параметры, обязан происходить. Раньше он
   * сравнивался по одному пути и молчал.
   */
  it("moves when only the parameters differ", () => {
    const navigation = createNavigation(window);
    const seen: string[] = [];
    navigation.subscribe((location) => seen.push(JSON.stringify(location.query)));

    const page = { kind: "plugin", pluginId: "tracker", pageId: "board", rest: "" } as const;
    navigation.navigate({ page, query: { filter: "warn" } });
    navigation.navigate({ page, query: { filter: "error" } });

    expect(window.location.search).toBe("?filter=error");
    expect(navigation.current().query).toEqual({ filter: "error" });
    expect(seen).toEqual(['{"filter":"warn"}', '{"filter":"error"}']);
  });

  it("stays put when the whole address is the same", () => {
    const navigation = createNavigation(window);
    const listener = vi.fn();
    navigation.subscribe(listener);

    navigation.navigate({ kind: "settings", section: "plugins" });
    navigation.navigate({ kind: "settings", section: "plugins" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  /** Голый `Page` значит «без параметров»: маршруты ядра о них не знают и не обязаны узнавать. */
  it("takes a bare page for an address without parameters", () => {
    window.history.replaceState(undefined, "", "/p/tracker/board?filter=warn");
    const navigation = createNavigation(window);

    navigation.navigate({ kind: "settings", section: "plugins" });

    expect(window.location.search).toBe("");
  });

  /**
   * Канонизация переезжает со старого адреса на новый и трогает только путь: параметры и якорь
   * маршруту не принадлежат, и стирать их переездом нельзя.
   */
  it("keeps the query and the fragment while canonicalising a legacy path", () => {
    window.history.replaceState(undefined, "", "/providers/anthropic?tab=models#log");
    const navigation = createNavigation(window);

    expect(navigation.current().page).toEqual({
      kind: "settings",
      section: "providers",
      providerId: "anthropic",
    });
    expect(window.location.pathname).toBe("/settings/providers/anthropic");
    expect(window.location.search).toBe("?tab=models");
    expect(window.location.hash).toBe("#log");
  });

  /**
   * Слушатель истории живёт ровно столько, сколько есть кому слушать: он появляется с первой
   * подпиской и снимается с последней отпиской. Иначе он висел бы на окне навсегда.
   */
  it("listens to history only while somebody listens to it", () => {
    const navigation = createNavigation(window);
    const listener = vi.fn();

    const unsubscribe = navigation.subscribe(listener);
    window.dispatchEvent(new PopStateEvent("popstate"));
    unsubscribe();
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  /**
   * `StrictMode` проигрывает подписку дважды: отписка второго прохода не вправе оставить окно без
   * слушателя. Ловля живой проверкой — кнопка «назад» меняла адрес, а экран оставался прежним.
   */
  it("keeps history reaching the app after a subscription is replayed", () => {
    const navigation = createNavigation(window);
    const first = vi.fn();
    const second = vi.fn();

    navigation.subscribe(first)();
    navigation.subscribe(second);
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(second).toHaveBeenCalledTimes(1);
  });
});
