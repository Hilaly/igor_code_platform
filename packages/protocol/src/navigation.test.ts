import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { corePlaces } from "./places.ts";
import { settingsSections, type CoreDestination } from "./navigation.ts";

describe("settingsSections", () => {
  /**
   * Список разделов и имена мест `core.settings.<section>` — одно и то же публичное утверждение.
   * Проверяется, а не обещается: разъехавшись, они дали бы раздел без места или место без адреса.
   */
  it("matches the settings places of the base delivery one to one", () => {
    const fromPlaces = corePlaces
      .filter(({ id }) => id.startsWith("core.settings."))
      .map(({ id }) => id.slice("core.settings.".length));

    assert.deepEqual([...settingsSections], fromPlaces);
  });
});

describe("CoreDestination", () => {
  /**
   * Перечень закрыт: расширить его можно минором, сузить — только мажором. Тест держит форму каждого
   * варианта, потому что именно она уезжает в бандл плагина.
   */
  it("names every address the host is willing to open", () => {
    const destinations: CoreDestination[] = [
      { kind: "home" },
      { kind: "session", sessionId: "01JD8Z" },
      { kind: "new-session" },
      { kind: "session-archive" },
      { kind: "settings", section: "plugins" },
      { kind: "plugin-page", pluginId: "placed", pageId: "log" },
      {
        kind: "plugin-page",
        pluginId: "placed",
        pageId: "log",
        path: "/entry/3",
        query: { filter: "warn" },
      },
    ];

    assert.deepEqual(
      destinations.map((destination) => destination.kind),
      [
        "home",
        "session",
        "new-session",
        "session-archive",
        "settings",
        "plugin-page",
        "plugin-page",
      ],
    );
  });
});
