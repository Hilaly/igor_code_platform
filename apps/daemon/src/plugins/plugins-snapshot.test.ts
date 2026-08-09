import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import {
  defaultConfig,
  defaultPreferences,
  pluginsPath,
  type AgentContributionRegistration,
  type PluginPreferences,
  type PluginStatus,
} from "@sovereign/protocol";

import { createContributionRegistry } from "./contribution-registry.ts";
import { createDispatcher } from "../http/public.ts";
import { createLogger } from "../platform/public.ts";
import { buildPluginsSnapshot, pluginsRoute } from "./plugins-snapshot.ts";

const running: PluginStatus = {
  key: "data:hello",
  id: "hello",
  source: "data",
  directory: "/plugins/hello",
  state: "running",
};

const refused: PluginStatus = {
  key: "data:broken",
  source: "data",
  directory: "/plugins/broken",
  state: "refused",
  reason: "sovereign.id must match ^[a-z0-9][a-z0-9-]*$",
};

function sources(statuses: PluginStatus[], plugins: Record<string, PluginPreferences> = {}) {
  const registry = createContributionRegistry();

  return {
    plugins: { statuses: () => statuses },
    registry,
    settings: {
      current: () => ({
        config: defaultConfig,
        preferences: { ...defaultPreferences, plugins },
      }),
    },
  };
}

describe("buildPluginsSnapshot", () => {
  it("does not expose file-backed agent locations in the public snapshot", () => {
    const state = sources([running]);
    const agent: AgentContributionRegistration = {
      ownership: "plugin",
      pluginKey: "data:hello",
      pluginId: "hello",
      source: "data",
      id: "hello.agent",
      declaredId: "agent",
      kind: "agent",
      location: "/private/plugins/hello/agents/agent/AGENT.md",
      instructions: "instructions",
      tools: { include: [], exclude: [] },
      skills: { include: [], exclude: [] },
    };

    const registry = {
      ...state.registry,
      pluginContributions: () => [agent],
      switchedOff: () => [agent],
    };

    const snapshot = buildPluginsSnapshot({ ...state, registry });

    assert.equal("location" in snapshot.contributions[0]!, false);
    assert.equal("location" in snapshot.switchedOffContributions[0]!, false);
  });

  it("puts together the supervisor statuses, the contributions and the revision", () => {
    const state = sources([running, refused]);

    state.registry.apply(
      { key: "data:hello", id: "hello", source: "data" },
      [{ kind: "custom", id: "greeting" }],
      new Set(),
    );

    assert.deepEqual(buildPluginsSnapshot(state), {
      revision: 1,
      plugins: [running, refused],
      contributions: [
        {
          ownership: "plugin",
          id: "hello.greeting",
          declaredId: "greeting",
          kind: "custom",
          pluginKey: "data:hello",
          pluginId: "hello",
          source: "data",
        },
      ],
      switchedOffContributions: [],
      conflicts: [],
      routeConflicts: [],
      // У плагина из данных нет записи, значит решение выведено по источнику: включает человек.
      enablement: { "data:hello": { enabled: false, disabledContributions: [] } },
    });
  });

  it("carries the browser asset addresses of a status through untouched", () => {
    // Снимок не пересобирает статус по полям, и адреса ассетов доезжают до страницы сами.
    const browser = {
      revision: "abcdefghijkl",
      entry: "/plugin-assets/data%3Ahello/abcdefghijkl/browser.js",
    };
    const built: PluginStatus = { ...running, browser };

    assert.deepEqual(buildPluginsSnapshot(sources([built, refused])).plugins, [built, refused]);
  });

  it("tells the recorded enablement apart from the one derived from the source", () => {
    const state = sources([running], {
      "data:hello": { enabled: true, disabledContributions: ["hello.panel"] },
    });

    assert.deepEqual(buildPluginsSnapshot(state).enablement, {
      "data:hello": { enabled: true, disabledContributions: ["hello.panel"] },
    });
  });

  it("gives no enablement record to a plugin refused before its manifest was read", () => {
    // Ключ такого плагина — путь к папке, и записывать предпочтения по нему некуда.
    const withoutIdentifier: PluginStatus = { ...refused, key: "/plugins/broken" };

    assert.deepEqual(buildPluginsSnapshot(sources([withoutIdentifier])).enablement, {});
  });

  it("reports the switched off contributions and the conflicts of the registry", () => {
    const state = sources([running], {
      "data:hello": { enabled: true, disabledContributions: ["hello.panel"] },
    });

    state.registry.apply(
      { key: "data:hello", id: "hello", source: "data" },
      [
        { kind: "custom", id: "greeting" },
        { kind: "custom", id: "panel", title: "Panel" },
      ],
      new Set(["hello.panel"]),
    );
    state.registry.apply(
      { key: "data:notes", id: "hello", source: "data" },
      [{ kind: "custom", id: "greeting" }],
      new Set(),
    );

    const snapshot = buildPluginsSnapshot(state);

    // Выключенный вклад приходит целиком: интерфейсу нужен и вид, и название, а не идентификатор.
    assert.deepEqual(
      snapshot.switchedOffContributions.map((registration) => [
        registration.id,
        registration.title,
      ]),
      [["hello.panel", "Panel"]],
    );
    assert.deepEqual(snapshot.conflicts, [
      { id: "hello.greeting", source: "data", plugins: ["data:hello", "data:notes"] },
    ]);
    assert.deepEqual(snapshot.routeConflicts, []);
    assert.deepEqual(snapshot.contributions, []);
    assert.equal(snapshot.revision, state.registry.revision());
  });

  it("reads the state at the moment of the request, not at the moment of wiring", () => {
    const state = sources([running]);
    const before = buildPluginsSnapshot(state);

    state.registry.remove("data:hello");
    state.registry.apply(
      { key: "data:hello", id: "hello", source: "data" },
      [{ kind: "custom", id: "later" }],
      new Set(),
    );

    assert.equal(before.contributions.length, 0);
    assert.equal(buildPluginsSnapshot(state).contributions.length, 1);
  });

  it("keeps project-owned declarations visible to plugin management", () => {
    const state = sources([running]);

    state.registry.applyPlugin(
      { key: "project:p1:hello", id: "hello", source: "project:p1" },
      [{ kind: "custom", id: "panel" }],
      new Set(),
    );
    state.registry.applyPlugin(
      { key: "project:p2:hello", id: "hello", source: "project:p2" },
      [{ kind: "custom", id: "panel" }],
      new Set(),
    );

    assert.deepEqual(
      buildPluginsSnapshot(state).contributions.map((registration) => registration.source),
      ["project:p1", "project:p2"],
    );
  });

  it("reports route address conflicts separately from effective contributions", () => {
    const state = sources([running]);

    state.registry.apply(
      { key: "data:hello", id: "hello", source: "data" },
      [
        { kind: "public-route", id: "first", method: "POST", path: "hooks/github" },
        { kind: "public-route", id: "second", method: "POST", path: "hooks/github" },
      ],
      new Set(),
    );

    const snapshot = buildPluginsSnapshot(state);

    assert.deepEqual(snapshot.routeConflicts, [
      {
        method: "POST",
        path: "hooks/github",
        contributions: ["hello.first", "hello.second"],
        pluginKeys: ["data:hello", "data:hello"],
      },
    ]);
    // The administrative contribution snapshot keeps both declarations so the operator can fix them;
    // the route table decides that neither one is effective.
    assert.equal(snapshot.contributions.length, 2);
  });

  it("uses route parameter shape when reporting an address conflict", () => {
    const state = sources([running]);

    state.registry.apply(
      { key: "data:hello", id: "hello", source: "data" },
      [
        { kind: "route", id: "by-id", method: "GET", path: "items/:id" },
        { kind: "route", id: "by-name", method: "GET", path: "items/:name" },
      ],
      new Set(),
    );

    assert.deepEqual(buildPluginsSnapshot(state).routeConflicts, [
      {
        method: "GET",
        path: "items/:",
        contributions: ["hello.by-id", "hello.by-name"],
        pluginKeys: ["data:hello", "data:hello"],
      },
    ]);
  });

  it("keeps standalone conflicts in project resources rather than plugin management", () => {
    const state = sources([running]);
    const registration = (source: string) => ({
      ownership: "standalone" as const,
      kind: "skill" as const,
      id: "review",
      declaredId: "review",
      source,
      scope: "user" as const,
      name: "review",
      description: "Review changes",
      location: `/${source}/review/SKILL.md`,
      disableModelInvocation: false,
    });

    state.registry.applyStandalone({
      rootKey: "first:skills",
      source: "first",
      scope: "user",
      precedence: 100,
      contributions: [
        {
          kind: "skill",
          path: "/first/review/SKILL.md",
          diagnostics: [],
          registration: registration("first"),
        },
      ],
    });
    state.registry.applyStandalone({
      rootKey: "second:skills",
      source: "second",
      scope: "user",
      precedence: 100,
      contributions: [
        {
          kind: "skill",
          path: "/second/review/SKILL.md",
          diagnostics: [],
          registration: registration("second"),
        },
      ],
    });

    assert.deepEqual(buildPluginsSnapshot(state).conflicts, []);
    assert.deepEqual(buildPluginsSnapshot(state).routeConflicts, []);
  });
});

describe("pluginsRoute", () => {
  it("answers with the snapshot as json", async () => {
    const state = sources([running]);
    const server = createServer(
      createDispatcher({
        routes: [pluginsRoute(state)],
        logger: createLogger({ source: "core", level: () => "debug", write: () => {} }),
        authenticate: () => ({ kind: "session" as const, id: "the-session" }),
      }),
    );

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const { port } = server.address() as AddressInfo;
      const answer = await fetch(`http://127.0.0.1:${port}${pluginsPath}`);

      assert.equal(answer.status, 200);
      assert.equal(answer.headers.get("content-type"), "application/json");
      assert.deepEqual(await answer.json(), buildPluginsSnapshot(state));
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
