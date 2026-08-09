import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ComponentContributionRegistration,
  PlaceContributionRegistration,
} from "./contribution.ts";
import { isPlaceCardinality } from "./contribution.ts";
import {
  corePlace,
  corePlaces,
  orderPlaceContributions,
  resolvePlaceDeclaration,
  resolvePlaceProvider,
  type PlaceContext,
} from "./places.ts";
import type { PluginSource } from "./plugin.ts";

const component = (
  declaredId: string,
  source: PluginSource,
  extra: { placeId?: string; group?: string; order?: number } = {},
): ComponentContributionRegistration => ({
  ownership: "plugin",
  pluginKey: `${source}:${declaredId}`,
  pluginId: declaredId,
  source,
  id: `${declaredId}.panel`,
  declaredId: "panel",
  kind: "component",
  placeId: "core.settings.plugins",
  export: "Panel",
  ...extra,
});

const place = (declaredId: string, source: PluginSource): PlaceContributionRegistration => ({
  ownership: "plugin",
  pluginKey: `${source}:${declaredId}`,
  pluginId: declaredId,
  source,
  id: `${declaredId}.place`,
  declaredId: "place",
  kind: "place",
  cardinality: "single",
  replaceable: true,
  builtIn: "Place",
});

const windowWide: PlaceContext = {};
const inProject: PlaceContext = { project: "work" };

describe("corePlaces", () => {
  it("names every place in the namespace of the core and only once", () => {
    const ids = corePlaces.map((place) => place.id);

    assert.deepEqual(
      ids.filter((id) => !id.startsWith("core.")),
      [],
    );
    assert.equal(new Set(ids).size, ids.length);
  });

  /** Заменяемо только одиночное: коллекцию и полосу действий занять целиком нельзя. */
  it("declares only single places replaceable", () => {
    assert.deepEqual(
      corePlaces.filter((place) => place.replaceable && place.cardinality !== "single"),
      [],
    );
  });

  /** Правая панель перестала быть заглушкой: вкладку в неё приносит вклад (docs/ui-kit.md). */
  it("publishes the right panel as a tabs place owned by the shell", () => {
    assert.deepEqual(corePlace("core.panel.tabs"), {
      id: "core.panel.tabs",
      cardinality: "tabs",
      replaceable: false,
    });
    assert.ok(isPlaceCardinality("tabs"));
  });
});

describe("resolvePlaceProvider", () => {
  it("leaves the built-in provider in place when nobody claims it", () => {
    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [], windowWide), {
      kind: "built-in",
    });
  });

  it("gives the place to the only claimant", () => {
    const claimant = component("themed", "data");

    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [claimant], windowWide), {
      kind: "plugin",
      contribution: claimant,
    });
  });

  it("prefers the more specific source", () => {
    const builtin = component("themed", "builtin");
    const data = component("other", "data");

    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [builtin, data], windowWide), {
      kind: "plugin",
      contribution: data,
    });
  });

  /** Тот же довод, что у спора вкладов в реестре: молчаливый победитель зависел бы от порядка. */
  it("applies nobody when two claimants of the same rank lead", () => {
    const first = component("first", "data");
    const second = component("second", "data");

    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [second, first], windowWide), {
      kind: "disputed",
      contenders: [first, second],
    });
  });

  /**
   * Решение владельца продукта: плагин из папки проекта не заменяет оконное вью. Проверяется обеими
   * сторонами — иначе фильтр по проекту можно было бы удалить, не уронив ни одного теста.
   */
  it("does not let a project folder plugin take a window-wide place", () => {
    const projectOwned = component("themed", "project:work");

    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [projectOwned], windowWide), {
      kind: "built-in",
    });
    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [projectOwned], inProject), {
      kind: "plugin",
      contribution: projectOwned,
    });
  });

  it("ignores a claim on a place of another project", () => {
    const elsewhere = component("themed", "project:spare");

    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [elsewhere], inProject), {
      kind: "built-in",
    });
  });

  it("ignores contributions addressed to another place", () => {
    const elsewhere = component("themed", "data", { placeId: "core.session.chat" });

    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [elsewhere], windowWide), {
      kind: "built-in",
    });
  });

  it("resolves identity before filtering the place", () => {
    const data = component("themed", "data", { placeId: "core.settings.plugins" });
    const project = {
      ...data,
      pluginKey: "project:work:themed",
      source: "project:work" as const,
      placeId: "core.session.chat",
    };

    assert.deepEqual(
      resolvePlaceProvider("core.settings.plugins", [data, project], { project: "work" }),
      { kind: "built-in" },
    );
    assert.deepEqual(
      resolvePlaceProvider("core.session.chat", [data, project], { project: "work" }),
      {
        kind: "plugin",
        contribution: project,
      },
    );
    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [data, project], {}), {
      kind: "plugin",
      contribution: data,
    });
  });

  it("does not let another project identity shadow the current context", () => {
    const data = component("themed", "data", { placeId: "core.settings.plugins" });
    const spare = {
      ...data,
      pluginKey: "project:spare:themed",
      source: "project:spare" as const,
      placeId: "core.session.chat",
    };

    assert.deepEqual(
      resolvePlaceProvider("core.settings.plugins", [data, spare], { project: "work" }),
      {
        kind: "plugin",
        contribution: data,
      },
    );
  });

  it("drops an identity claimed by two sources of the same rank", () => {
    const first = component("themed", "data");
    const second = { ...first, pluginKey: "data:other" };

    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [first, second], windowWide), {
      kind: "built-in",
    });
  });
});

describe("orderPlaceContributions", () => {
  it("orders by group, then order, then identifier", () => {
    const contributions = [
      component("d", "data", { group: "b", order: 1 }),
      component("c", "data", { group: "a", order: 2 }),
      component("b", "data", { group: "a", order: 1 }),
      component("a", "data", { group: "a", order: 1 }),
    ];

    assert.deepEqual(
      orderPlaceContributions("core.settings.plugins", contributions, windowWide).map(
        (registration) => registration.id,
      ),
      ["a.panel", "b.panel", "c.panel", "d.panel"],
    );
  });

  /** Коллекция складывает вклады, а не выбирает победителя: ранг источника её порядка не задаёт. */
  it("keeps claimants of every source, ordered without regard to rank", () => {
    const contributions = [component("z", "project:work"), component("a", "builtin")];

    assert.deepEqual(
      orderPlaceContributions("core.settings.plugins", contributions, inProject).map(
        (registration) => registration.id,
      ),
      ["a.panel", "z.panel"],
    );
  });

  it("resolves identity before filtering collection and action places", () => {
    const data = component("themed", "data", { placeId: "core.settings.plugins" });
    const project = {
      ...data,
      pluginKey: "project:work:themed",
      source: "project:work" as const,
      placeId: "core.session.chat",
    };

    assert.deepEqual(
      orderPlaceContributions("core.settings.plugins", [data, project], { project: "work" }),
      [],
    );
    assert.deepEqual(
      orderPlaceContributions("core.session.chat", [data, project], { project: "work" }),
      [project],
    );
    assert.deepEqual(orderPlaceContributions("core.settings.plugins", [data, project], {}), [data]);
  });

  it("resolves place declaration identity in the current context", () => {
    const data = place("owner", "data");
    const project = {
      ...data,
      pluginKey: "project:work:owner",
      source: "project:work" as const,
    };
    const spare = {
      ...data,
      pluginKey: "project:spare:owner",
      source: "project:spare" as const,
    };

    assert.deepEqual(
      resolvePlaceDeclaration(data.id, [data, project], { project: "work" }),
      project,
    );
    assert.deepEqual(resolvePlaceDeclaration(data.id, [data, spare], { project: "work" }), data);
    assert.deepEqual(resolvePlaceDeclaration(data.id, [data, project], {}), data);
  });
});
