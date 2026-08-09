import { describe, expect, it } from "vitest";

import { corePlaces } from "@sovereign/protocol";

import { settingsSections } from "./navigation.ts";

describe("settingsSections", () => {
  /**
   * Список разделов и имена мест `core.settings.<section>` — одно и то же публичное утверждение.
   * Проверяется, а не обещается: разъехавшись, они дали бы раздел без места или место без адреса.
   */
  it("matches the settings places of the base delivery one to one", () => {
    const fromPlaces = corePlaces
      .filter(({ id }) => id.startsWith("core.settings."))
      .map(({ id }) => id.slice("core.settings.".length));

    expect(settingsSections).toEqual(fromPlaces);
  });
});
