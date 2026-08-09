import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CommandContributionRegistration,
  ComponentContributionRegistration,
  PageContributionRegistration,
  PlaceContributionRegistration,
} from "./contribution.ts";
import { isPlaceCardinality } from "./contribution.ts";
import {
  componentsForPlace,
  contributionsForPlace,
  corePlace,
  corePlaces,
  orderPlaceContributions,
  resolvePlaceDeclaration,
  resolvePlaceProvider,
  resolvePluginPage,
  toolCallPlaceId,
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

const command = (
  declaredId: string,
  source: PluginSource,
  extra: { placeId?: string; group?: string; order?: number } = {},
): CommandContributionRegistration => ({
  ownership: "plugin",
  pluginKey: `${source}:${declaredId}`,
  pluginId: declaredId,
  source,
  id: `${declaredId}.run`,
  declaredId: "run",
  kind: "command",
  title: "Run",
  placeId: "core.view.header.actions",
  export: "RunCommand",
  ...extra,
});

const page = (
  pluginId: string,
  source: PluginSource,
  declaredId = "log",
): PageContributionRegistration => ({
  ownership: "plugin",
  pluginKey: `${source}:${pluginId}`,
  pluginId,
  source,
  id: `${pluginId}.${declaredId}`,
  declaredId,
  kind: "page",
  title: "Log",
  export: "LogPage",
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

describe("toolCallPlaceId", () => {
  it("encodes an arbitrary tool name as one valid dynamic core place", () => {
    assert.equal(toolCallPlaceId("spawn_agent"), "core.session.tool-call.t-737061776e5f6167656e74");
    assert.match(
      toolCallPlaceId("mcp__github.create/issue"),
      /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/,
    );
  });

  it("does not collapse distinct exact tool names", () => {
    const names = ["write_file", "write-file", "é", "e\u0301", "工具"];
    const ids = names.map(toolCallPlaceId);

    assert.equal(new Set(ids).size, names.length);
  });
});

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

  it("publishes every Settings section as a replaceable single place", () => {
    const expected = [
      "core.settings.projects",
      "core.settings.appearance",
      "core.settings.usage",
      "core.settings.providers",
      "core.settings.plugins",
      "core.settings.daemon",
      "core.settings.diagnostics",
    ];

    assert.deepEqual(
      corePlaces
        .filter(({ id }) => id.startsWith("core.settings."))
        .map(({ id, cardinality, replaceable }) => ({ id, cardinality, replaceable })),
      expected.map((id) => ({ id, cardinality: "single", replaceable: true })),
    );
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

  /**
   * Кнопка команды стоит в той же полосе, что и компоненты, значит и порядок у них общий: два ряда,
   * сложенные по разным правилам, прыгали бы друг относительно друга.
   */
  it("puts commands and components into one order", () => {
    const contributions = [
      command("z", "data", { group: "a", order: 1 }),
      component("a", "data", { placeId: "core.view.header.actions", group: "a", order: 2 }),
      command("a", "data", { group: "a", order: 1 }),
    ];

    assert.deepEqual(
      orderPlaceContributions("core.view.header.actions", contributions, windowWide).map(
        (registration) => registration.id,
      ),
      ["a.run", "z.run", "a.panel"],
    );
  });

  it("keeps commands of another project out of the context", () => {
    const elsewhere = command("themed", "project:spare");

    assert.deepEqual(contributionsForPlace("core.view.header.actions", [elsewhere], inProject), []);
    assert.deepEqual(
      contributionsForPlace("core.view.header.actions", [elsewhere], windowWide),
      [],
    );
  });

  /** Команда одиночное место занять не может, поэтому в спор за провайдера она не входит. */
  it("hides commands from the component lookup that resolves a provider", () => {
    const claimant = command("themed", "data", { placeId: "core.settings.plugins" });

    assert.deepEqual(componentsForPlace("core.settings.plugins", [claimant], windowWide), []);
    assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [claimant], windowWide), {
      kind: "built-in",
    });
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

describe("resolvePluginPage", () => {
  /** Адрес `/p/<pluginId>/<pageId>` читается по паре, а не по идентификатору с неймспейсом. */
  it("addresses a page by the plugin id and the declared id", () => {
    const log = page("placed", "data");

    assert.deepEqual(resolvePluginPage("placed", "log", [log], windowWide), log);
    assert.equal(resolvePluginPage("placed", "placed.log", [log], windowWide), undefined);
    assert.equal(resolvePluginPage("rival", "log", [log], windowWide), undefined);
  });

  it("ignores contributions of every other kind", () => {
    assert.equal(
      resolvePluginPage("placed", "panel", [component("placed", "data")], windowWide),
      undefined,
    );
  });

  /** Копия из директории данных перекрывает встроенную — то же правило, что у команд и мест. */
  it("prefers the more specific source and drops a tie", () => {
    const builtIn = page("placed", "builtin");
    const data = page("placed", "data");
    const rivalRoot = { ...data, pluginKey: "data:placed-copy" };

    assert.deepEqual(resolvePluginPage("placed", "log", [builtIn, data], windowWide), data);
    assert.equal(resolvePluginPage("placed", "log", [data, rivalRoot], windowWide), undefined);
  });

  /**
   * Адрес страницы один на всё окно, поэтому вклад из папки проекта его не занимает: контекст
   * страницы оконный, а проектный вклад в нём неприменим.
   */
  it("does not let a project plugin take the window-wide address", () => {
    const project = { ...page("placed", "project:work"), pluginKey: "project:work:placed" };

    assert.equal(resolvePluginPage("placed", "log", [project], windowWide), undefined);
    assert.deepEqual(resolvePluginPage("placed", "log", [project], inProject), project);
  });
});
