import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { readBuiltinPlugins } from "./builtin-plugins-payload.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-builtin-payload-"));
let made = 0;

/** Рабочее пространство целиком: корень плагинов и корень пакетов, из которых едет зависимость. */
function repository(files: Record<string, string>): { pluginsRoot: string; packagesRoot: string } {
  made += 1;

  const root = join(workspace, `repository-${String(made)}`);

  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);

    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }

  return { pluginsRoot: join(root, "plugins"), packagesRoot: join(root, "packages") };
}

const sdk = {
  "packages/sdk/package.json": JSON.stringify({
    name: "@sovereign/sdk",
    version: "0.0.0",
    exports: { ".": "./src/index.ts", "./testing": "./src/testing.ts" },
  }),
  "packages/sdk/src/index.ts": "export const contribute = (value: string): string => value;\n",
  "packages/sdk/src/testing.ts": "export { contribute } from './index.ts';\n",
};

const plugin = (id: string, dependencies: Record<string, string> = {}): Record<string, string> => ({
  [`plugins/${id}/package.json`]: JSON.stringify({
    name: `@sovereign/plugin-${id}`,
    dependencies,
    sovereign: { id, worker: "src/worker.ts" },
  }),
  [`plugins/${id}/src/worker.ts`]: "export const activate = () => {};\n",
});

describe("readBuiltinPlugins", () => {
  it("takes every folder that declared itself a plugin and nothing else", async () => {
    const files = await readBuiltinPlugins(
      repository({
        ...plugin("starter"),
        ...plugin("subagents"),
        "plugins/README.md": "not a plugin",
        "plugins/.hidden/package.json": "{}",
        "plugins/notes/notes.md": "a folder without a manifest is not a plugin",
      }),
    );

    assert.deepEqual(
      [...files.keys()].sort(),
      [
        "starter/package.json",
        "starter/src/worker.ts",
        "subagents/package.json",
        "subagents/src/worker.ts",
      ].sort(),
    );
  });

  it("leaves behind what only the repository needs", async () => {
    const files = await readBuiltinPlugins(
      repository({
        ...plugin("starter"),
        "plugins/starter/tsconfig.json": "{}",
        "plugins/starter/vitest.config.ts": "export default {};",
        "plugins/starter/.DS_Store": "junk",
        "plugins/starter/src/worker.test.ts": "// a test",
        "plugins/starter/src/world.test-helper.ts": "// a helper for tests",
        "plugins/starter/node_modules/left-over/index.js": "// a stale install",
        "plugins/starter/agents/generic/AGENT.md": "# an agent",
      }),
    );

    assert.deepEqual([...files.keys()].sort(), [
      "starter/agents/generic/AGENT.md",
      "starter/package.json",
      "starter/src/worker.ts",
    ]);
  });

  it("ships a declared workspace dependency built, inside the folder of the plugin", async () => {
    const files = await readBuiltinPlugins(
      repository({ ...sdk, ...plugin("starter", { "@sovereign/sdk": "workspace:*" }) }),
    );
    const shipped = [...files.keys()].filter((path) => path.includes("node_modules"));

    // Внутри папки плагина, а не общим корнем: `node_modules` рядом с манифестом — то, из-за чего
    // установка зависимостей считает их привезёнными и не зовёт `npm`.
    assert.equal(
      shipped.includes("starter/node_modules/@sovereign/sdk/package.json"),
      true,
      shipped.join(", "),
    );

    const manifest = JSON.parse(
      Buffer.from(
        files.get("starter/node_modules/@sovereign/sdk/package.json") ?? new Uint8Array(),
      ).toString("utf8"),
    ) as { exports: Record<string, string> };

    // Собранным, а не исходниками: Node не стирает типы у файлов под `node_modules`.
    assert.deepEqual(manifest.exports, { ".": "./index.js", "./testing": "./testing.js" });
    assert.equal(files.has("starter/node_modules/@sovereign/sdk/index.js"), true);
    assert.equal(files.has("starter/node_modules/@sovereign/sdk/src/index.ts"), false);
  });

  it("refuses to build an artifact whose plugin needs something it cannot ship", async () => {
    await assert.rejects(
      readBuiltinPlugins(repository({ ...sdk, ...plugin("starter", { zod: "^4.4.3" }) })),
      // Молча собрать нельзя: `node_modules` у распакованного плагина есть, установка сочтёт
      // зависимости привезёнными, и плагин упадёт на импорте уже у пользователя.
      /starter depends on zod, which the artifact build does not know how to ship/,
    );
  });
});
