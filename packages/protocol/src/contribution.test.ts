import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as protocol from "./index.ts";
import { pluginRouteAddress, pluginRoutePrefix, projectOfContribution } from "./contribution.ts";

const pluginOwnership = {
  ownership: "plugin",
  pluginKey: "data:themed",
  pluginId: "themed",
} as const;

describe("pluginRouteAddress", () => {
  it("puts the plugin identifier and the declared path behind the prefix", () => {
    assert.equal(pluginRouteAddress("tasks", "board/:id"), "/api/p/tasks/board/:id");
  });

  it("gives the plugin itself an address when the declared path is empty", () => {
    assert.equal(pluginRouteAddress("tasks", ""), "/api/p/tasks");
  });
});

describe("the plugin route prefix", () => {
  /**
   * Сторож, а не описание: маршрут ядра со вторым сегментом `p` затенил бы разом все маршруты
   * плагинов, и заметить это можно было бы только запуском чужого плагина. Проверяется весь
   * протокол целиком, потому что новый маршрут ядра заводят в своём файле и про этот запрет не
   * вспоминают.
   */
  it("is not shadowed by any core route", () => {
    const shadowing = Object.entries(protocol as Record<string, unknown>)
      .filter(([name]) => name !== "pluginRoutePrefix")
      .filter(([, value]) => typeof value === "string" && value.startsWith("/api/"))
      .filter(([, value]) => (value as string).split("/")[2] === "p")
      .map(([name]) => name);

    assert.deepEqual(shadowing, []);
  });

  it("is itself under /api, so the daemon can tell a route from a page of a plugin", () => {
    assert.equal(pluginRoutePrefix.startsWith("/api/"), true);
  });
});

describe("projectOfContribution", () => {
  it("names the project of a plugin from a project folder and nobody else's", () => {
    assert.equal(projectOfContribution({ ...pluginOwnership, source: "project:work" }), "work");
    assert.equal(projectOfContribution({ ...pluginOwnership, source: "data" }), undefined);
    assert.equal(projectOfContribution({ ...pluginOwnership, source: "builtin" }), undefined);
  });

  it("reads the same answer off a standalone root, where the scope is written out", () => {
    assert.equal(
      projectOfContribution({
        ownership: "standalone",
        source: "native:hello",
        scope: "project",
        projectId: "work",
      }),
      "work",
    );
    assert.equal(
      projectOfContribution({ ownership: "standalone", source: "native:hello", scope: "user" }),
      undefined,
    );
  });
});
