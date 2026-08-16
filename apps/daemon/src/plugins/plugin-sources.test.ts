import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { platformVersion } from "@sovereign/protocol";

import {
  defaultPluginRoots,
  discoverPlugins,
  pluginKey,
  projectPluginRoots,
  type PluginRoot,
  type ProjectPluginFolder,
} from "./plugin-sources.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-plugin-sources-"));
let created = 0;

after(() => rmSync(workspace, { recursive: true, force: true }));

function freshRoot(): string {
  created += 1;
  const directory = join(workspace, `root-${created}`);
  mkdirSync(directory, { recursive: true });

  return directory;
}

type PluginFolderOptions = {
  sovereign?: Record<string, unknown> | undefined;
  manifest?: string;
  withWorker?: boolean;
};

function writePluginFolder(root: string, name: string, options: PluginFolderOptions = {}): string {
  const directory = join(root, name);
  mkdirSync(join(directory, "src"), { recursive: true });

  const sovereign =
    options.sovereign === undefined
      ? { id: name, worker: "src/worker.ts", platform: platformVersion }
      : options.sovereign;

  writeFileSync(
    join(directory, "package.json"),
    options.manifest ?? JSON.stringify({ name, version: "0.0.0", sovereign }, null, 2),
  );

  if (options.withWorker !== false) {
    writeFileSync(join(directory, "src", "worker.ts"), "export function activate() {}\n");
  }

  return directory;
}

const roots = (builtin: string, data: string): PluginRoot[] => [
  { source: "builtin", directory: builtin },
  { source: "data", directory: data },
];

describe("discoverPlugins", () => {
  it("finds plugins in both roots and keys them by source", () => {
    const builtin = freshRoot();
    const data = freshRoot();
    writePluginFolder(builtin, "tasks");
    writePluginFolder(data, "hello");

    const discovery = discoverPlugins(roots(builtin, data));

    assert.deepEqual(
      discovery.plugins.map((plugin) => plugin.key),
      ["builtin:tasks", "data:hello"],
    );
    assert.equal(discovery.refused.length, 0);
  });

  it("discovers agents and skills only inside each plugin directory", () => {
    const root = freshRoot();
    const directory = writePluginFolder(root, "file-resources");
    mkdirSync(join(directory, "agents", "helper"), { recursive: true });
    mkdirSync(join(directory, "skills", "review"), { recursive: true });
    writeFileSync(
      join(directory, "agents", "helper", "AGENT.md"),
      "---\nname: helper\ndescription: Helps with work\n---\n\nHelp carefully.\n",
    );
    writeFileSync(
      join(directory, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Reviews work\n---\n\nReview carefully.\n",
    );

    const plugin = discoverPlugins([{ source: "data", directory: root }]).plugins[0];

    assert.ok(plugin !== undefined);
    assert.deepEqual(
      plugin.fileResources.definitions.map(({ kind, name, entryPath }) => ({
        kind,
        name,
        entryPath,
      })),
      [
        {
          kind: "agent",
          name: "helper",
          entryPath: join(directory, "agents", "helper", "AGENT.md"),
        },
        {
          kind: "skill",
          name: "review",
          entryPath: join(directory, "skills", "review", "SKILL.md"),
        },
      ],
    );
    assert.deepEqual(plugin.fileResources.invalid, []);
    assert.deepEqual(plugin.fileResources.watchPaths, [directory]);
  });

  it("takes a missing root as an empty one", () => {
    const discovery = discoverPlugins([
      { source: "builtin", directory: join(workspace, "never-created") },
    ]);

    assert.deepEqual(discovery, { plugins: [], refused: [] });
  });

  it("skips a folder that does not declare itself a plugin", () => {
    const root = freshRoot();
    mkdirSync(join(root, "notes"), { recursive: true });
    writeFileSync(join(root, "notes", "readme.md"), "not a plugin\n");
    writePluginFolder(root, "some-package", { sovereign: undefined, manifest: "{}" });

    const discovery = discoverPlugins([{ source: "data", directory: root }]);

    assert.deepEqual(discovery, { plugins: [], refused: [] });
  });

  it("refuses a broken manifest with the reason", () => {
    const root = freshRoot();
    writePluginFolder(root, "broken", { manifest: "{ not json" });

    const discovery = discoverPlugins([{ source: "data", directory: root }]);

    assert.equal(discovery.plugins.length, 0);
    assert.match(discovery.refused[0]?.reason ?? "", /not valid json/);
  });

  it("refuses a plugin whose entry point is missing", () => {
    const root = freshRoot();
    writePluginFolder(root, "hollow", { withWorker: false });

    const discovery = discoverPlugins([{ source: "data", directory: root }]);

    assert.equal(discovery.refused[0]?.id, "hollow");
    assert.match(discovery.refused[0]?.reason ?? "", /does not exist/);
  });

  it("refuses an incompatible platform version", () => {
    const root = freshRoot();
    writePluginFolder(root, "ahead", {
      sovereign: { id: "ahead", worker: "src/worker.ts", platform: "^9.0.0" },
    });

    const discovery = discoverPlugins([{ source: "data", directory: root }]);

    assert.match(discovery.refused[0]?.reason ?? "", /requires platform \^9\.0\.0/);
  });

  it("keeps the same identifier from two sources as two plugins", () => {
    const builtin = freshRoot();
    const data = freshRoot();
    writePluginFolder(builtin, "hello");
    writePluginFolder(data, "hello");

    const discovery = discoverPlugins(roots(builtin, data));

    assert.deepEqual(
      discovery.plugins.map((plugin) => plugin.key),
      [pluginKey("builtin", "hello"), pluginKey("data", "hello")],
    );
  });

  it("refuses both folders that claim one identifier inside one source", () => {
    const root = freshRoot();
    writePluginFolder(root, "first", {
      sovereign: { id: "hello", worker: "src/worker.ts", platform: "*" },
    });
    writePluginFolder(root, "second", {
      sovereign: { id: "hello", worker: "src/worker.ts", platform: "*" },
    });

    const discovery = discoverPlugins([{ source: "data", directory: root }]);

    assert.equal(discovery.plugins.length, 0);
    assert.equal(discovery.refused.length, 2);
    assert.match(discovery.refused[0]?.reason ?? "", /claimed by 2 folders/);
  });

  it("carries manifest diagnostics to the caller instead of logging them", () => {
    const root = freshRoot();
    writePluginFolder(root, "curious", {
      sovereign: { id: "curious", worker: "src/worker.ts", platform: "*", future: true },
    });

    const discovery = discoverPlugins([{ source: "data", directory: root }]);

    assert.deepEqual(discovery.plugins[0]?.diagnostics, [
      "sovereign.future is unknown and ignored",
    ]);
  });
});

describe("defaultPluginRoots", () => {
  it("finds the plugins shipped with the platform", () => {
    // Встроенный корень — каталог `plugins/` репозитория, и путь до него считается от исходников:
    // разъедься он с раскладкой, агент и скилы поставки исчезли бы молча.
    const discovery = discoverPlugins([defaultPluginRoots(freshRoot())[0] as PluginRoot]);

    assert.deepEqual(
      discovery.plugins.map((plugin) => plugin.key),
      ["builtin:mission", "builtin:starter", "builtin:subagents", "builtin:superpowers"],
    );
    assert.deepEqual(
      discovery.plugins
        .find((plugin) => plugin.key === "builtin:starter")
        ?.fileResources.definitions.map((definition) => [definition.kind, definition.name]),
      [
        ["agent", "generic"],
        ["skill", "creating-agents"],
        ["skill", "creating-prompt-templates"],
        ["skill", "creating-skills"],
        ["skill", "plugin-backend"],
        ["skill", "plugin-frontend"],
      ],
    );
    assert.deepEqual(discovery.refused, []);
  });

  it("takes the builtin root from the caller when it is given one", () => {
    // В артефакте встроенные лежат распакованными в директории данных, а не рядом с исходниками
    // (docs/toolchain.md). Меняется только место: источник и ключ остаются прежними, поэтому
    // данные встроенного плагина переживают переход с исходников на артефакт.
    const unpacked = freshRoot();

    assert.deepEqual(defaultPluginRoots(freshRoot(), unpacked)[0], {
      source: "builtin",
      directory: unpacked,
    });
  });
});

describe("projectPluginRoots", () => {
  const folder = (
    id: string,
    overrides: Partial<ProjectPluginFolder> = {},
  ): ProjectPluginFolder => ({
    id,
    folder: `/code/${id}`,
    archived: false,
    ...overrides,
  });

  it("gives every working project the Sovereign plugins folder inside it", () => {
    assert.deepEqual(
      projectPluginRoots([folder("work"), folder("b7Kq3xv9pQdT")], () => "available"),
      [
        { source: "project:work", directory: join("/code/work", ".sovereign", "plugins") },
        {
          source: "project:b7Kq3xv9pQdT",
          directory: join("/code/b7Kq3xv9pQdT", ".sovereign", "plugins"),
        },
      ],
    );
  });

  it("takes the source away from an archived project", () => {
    // «Убран с глаз» обязано значить и «его код не работает»: иначе архивация прячет проект в
    // интерфейсе, но оставляет его плагины перекрывать чужие вклады.
    assert.deepEqual(
      projectPluginRoots([folder("a", { archived: true })], () => "available"),
      [],
    );
  });

  it("takes the source away from a project whose folder is not there", () => {
    assert.deepEqual(
      projectPluginRoots([folder("a")], () => "missing"),
      [],
    );
  });
});
