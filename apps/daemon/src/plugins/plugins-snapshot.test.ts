import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import {
  defaultConfig,
  defaultPreferences,
  pluginsPath,
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
      // У плагина из данных нет записи, значит решение выведено по источнику: включает человек.
      enablement: { "data:hello": { enabled: false, disabledContributions: [] } },
    });
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
