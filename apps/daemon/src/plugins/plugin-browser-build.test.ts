import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { hostModuleRegistryKey, pluginBrowserFileNames } from "@sovereign/protocol";

import {
  buildPluginBrowser,
  stopPluginBrowserBuilds,
  type PluginBrowserBundle,
} from "./plugin-browser-build.ts";

const fixtures = join(import.meta.dirname, "fixtures");
const browsered = join(fixtures, "browsered");
const placed = join(fixtures, "placed");
const rival = join(fixtures, "rival");
const workspace = mkdtempSync(join(tmpdir(), "sovereign-plugin-browser-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
  // Иначе дочерний процесс-сервис esbuild держит прогон открытым до таймаута.
  stopPluginBrowserBuilds();
});

let created = 0;

/** Копия фикстуры, которую тесту можно править: сама фикстура остаётся неизменной для соседей. */
function copyOfBrowsered(): string {
  created += 1;
  const directory = join(workspace, `browsered-${created}`);
  cpSync(browsered, directory, { recursive: true });

  return directory;
}

function textOf(bundle: PluginBrowserBundle, file: string): string {
  const contents = bundle.files.get(file);

  assert.ok(contents !== undefined, `the bundle has no ${file}`);

  return Buffer.from(contents).toString("utf8");
}

async function buildBrowsered(
  pluginKey = "data:browsered",
  directory = browsered,
): Promise<PluginBrowserBundle> {
  const outcome = await buildPluginBrowser({
    pluginKey,
    directory,
    browserEntry: "src/browser.tsx",
  });

  assert.equal(outcome.kind, "built", outcome.kind === "failed" ? outcome.reason : "");
  assert.ok(outcome.kind === "built");

  return outcome.bundle;
}

async function buildTrackedBrowser(
  pluginKey: "data:placed" | "data:rival",
  directory: string,
): Promise<PluginBrowserBundle> {
  const outcome = await buildPluginBrowser({
    pluginKey,
    directory,
    browserEntry: "src/browser.tsx",
  });

  assert.equal(outcome.kind, "built", outcome.kind === "failed" ? outcome.reason : "");
  assert.ok(outcome.kind === "built");

  return outcome.bundle;
}

describe("buildPluginBrowser", () => {
  it("builds nothing for a plugin without a browser entry point", async () => {
    const outcome = await buildPluginBrowser({ pluginKey: "data:hello", directory: browsered });

    assert.deepEqual(outcome, { kind: "not-needed" });
  });

  it("produces a flat bundle with a script, styles and their source maps", async () => {
    const bundle = await buildBrowsered();

    assert.deepEqual([...bundle.files.keys()].sort(), [
      "browser.css",
      "browser.css.map",
      "browser.js",
      "browser.js.map",
    ]);
    assert.equal(bundle.files.get(pluginBrowserFileNames.script) !== undefined, true);
    assert.equal(bundle.files.get(pluginBrowserFileNames.styles) !== undefined, true);
  });

  it("derives the revision from the content, so an unchanged plugin keeps its address", async () => {
    const first = await buildBrowsered();
    const second = await buildBrowsered();

    assert.equal(first.revision, second.revision);
    assert.match(first.revision, /^[A-Za-z0-9_-]{12}$/);
  });

  it("changes the revision when a source file changes", async () => {
    const directory = copyOfBrowsered();
    const before = await buildBrowsered("data:browsered", directory);

    writeFileSync(join(directory, "src", "badge.module.css"), ".badge { display: block; }\n");

    const after = await buildBrowsered("data:browsered", directory);

    assert.notEqual(before.revision, after.revision);
  });

  describe("host modules", () => {
    it("takes react and the kit from the registry instead of bundling them", async () => {
      const bundle = await buildBrowsered();
      const script = textOf(bundle, pluginBrowserFileNames.script);

      assert.match(script, new RegExp(hostModuleRegistryKey));
      // Собственный React в бандле выдал бы себя своими внутренностями.
      assert.doesNotMatch(script, /react\.production|ReactCurrentOwner|__SECRET_INTERNALS/);
    });

    /**
     * Единственная проверка externals, которая что-то доказывает: собранный бандл исполняется с
     * подставленным реестром. Браузера для этого не нужно — модуль обычный ESM.
     */
    it("resolves named, default and namespace imports through the registry", async () => {
      const bundle = await buildBrowsered();
      const registry = globalThis as unknown as Record<string, unknown>;
      const previous = registry[hostModuleRegistryKey];
      const browserPlace = () => null;

      registry[hostModuleRegistryKey] = {
        react: { version: "19.2.8", useState: () => [0, () => {}] },
        "react-dom": { createPortal: () => null, flushSync: () => {} },
        "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: Symbol("Fragment") },
        "@sovereign/ui-kit": { Badge: () => null },
        "@sovereign/browser-sdk": { Place: browserPlace, PlaceCollection: () => null },
      };

      try {
        const loaded = (await importBuiltBundle(writeBundle(bundle))) as {
          reactVersion: string;
          reactDomKeys: string[];
          classNames: Record<string, string>;
          browserPlace: unknown;
          View: unknown;
        };

        assert.equal(loaded.reactVersion, "19.2.8");
        assert.deepEqual(loaded.reactDomKeys.sort(), ["createPortal", "default", "flushSync"]);
        assert.equal(loaded.browserPlace, browserPlace);
        assert.equal(typeof loaded.View, "function");
      } finally {
        registry[hostModuleRegistryKey] = previous;
      }
    });

    it("executes the tracked owner and rival places through the public browser SDK", async () => {
      type Element = { type: unknown; props: Record<string, unknown> };

      const registry = globalThis as unknown as Record<string, unknown>;
      const previous = registry[hostModuleRegistryKey];
      const place = () => null;
      const placeCollection = () => null;
      const Badge = () => null;
      const Heading = () => null;
      const Text = () => null;
      const element = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });

      registry[hostModuleRegistryKey] = {
        react: { useState: () => [0, () => {}] },
        "react/jsx-runtime": {
          jsx: element,
          jsxs: element,
          Fragment: Symbol("Fragment"),
        },
        "@sovereign/ui-kit": { Badge, Heading, Text },
        "@sovereign/browser-sdk": { Place: place, PlaceCollection: placeCollection },
      };

      try {
        const placedModule = (await importBuiltBundle(
          writeBundle(await buildTrackedBrowser("data:placed", placed)),
        )) as {
          PluginsPanel: (properties: { context: Record<string, unknown> }) => Element;
          Board: (properties: { context: Record<string, unknown> }) => Element;
          SidebarSection: () => Element;
          HeaderAction: () => Element;
          Boom: () => never;
        };
        const rivalModule = (await importBuiltBundle(
          writeBundle(await buildTrackedBrowser("data:rival", rival)),
        )) as {
          PluginsPanel: () => Element;
          Board: (properties: { context: Record<string, unknown> }) => Element;
          BoardAction: () => Element;
        };
        const context = { project: "the test project", subject: { view: "plugins" } };
        const panel = placedModule.PluginsPanel({ context });
        const children = panel.props["children"] as Element[];
        const ownerPlace = children.find((child) => child.type === place);
        const ownerActions = children.find((child) => child.type === placeCollection);

        assert.deepEqual(ownerPlace?.props, { id: "placed.board", context });
        assert.deepEqual(ownerActions?.props, { id: "placed.board-actions", context });
        assert.deepEqual(placedModule.Board({ context }).props["children"], [
          "the built-in board for ",
          "the test project",
        ]);
        assert.equal(typeof placedModule.SidebarSection, "function");
        assert.equal(typeof placedModule.HeaderAction, "function");
        assert.throws(() => placedModule.Boom(), /the placed plugin cannot render this/);
        assert.equal(typeof rivalModule.PluginsPanel, "function");
        assert.deepEqual(rivalModule.Board({ context }).props["children"], [
          "the rival replacement board for ",
          "the test project",
        ]);
        assert.equal(rivalModule.BoardAction().props["children"], "rival board action");
      } finally {
        registry[hostModuleRegistryKey] = previous;
      }
    });

    it("says which host module is missing instead of failing somewhere deeper", async () => {
      const bundle = await buildBrowsered();
      const registry = globalThis as unknown as Record<string, unknown>;
      const previous = registry[hostModuleRegistryKey];

      registry[hostModuleRegistryKey] = { react: { version: "19.2.8" } };

      try {
        await assert.rejects(
          () => importBuiltBundle(writeBundle(bundle)),
          /the host module react-dom is not registered/,
        );
      } finally {
        registry[hostModuleRegistryKey] = previous;
      }
    });
  });

  describe("css modules", () => {
    it("keeps the local names as written and adds no camelCase twin", async () => {
      const bundle = await buildBrowsered();
      const script = textOf(bundle, pluginBrowserFileNames.script);

      assert.match(script, /"badge-tail"/);
      assert.doesNotMatch(script, /badgeTail/);
    });

    it("keeps local names readable and passes :global and composes through", async () => {
      const styles = textOf(await buildBrowsered(), pluginBrowserFileNames.styles);

      assert.match(styles, /\.ZGF0YTpicm93c2VyZWQ_badge_badge\{display:inline-flex\}/);
      assert.match(styles, /\.sovereign-plugin-anchor \.ZGF0YTpicm93c2VyZWQ_badge_badge/);
      assert.match(styles, /\.ZGF0YTpicm93c2VyZWQ_badge_loud/);
    });

    /**
     * У esbuild в имени класса нет хеша вовсе: без ключа плагина в имени два плагина с одинаковым
     * `badge.module.css` молча перекрыли бы стили друг друга.
     */
    it("gives two colliding-safe plugin keys different class names for the same stylesheet", async () => {
      const mine = textOf(
        await buildBrowsered("project:foo-bar:browsered"),
        pluginBrowserFileNames.styles,
      );
      const theirs = textOf(
        await buildBrowsered("project:foo:bar-browsered"),
        pluginBrowserFileNames.styles,
      );

      assert.notEqual(mine, theirs);
    });
  });

  describe("failures", () => {
    it("reports an unresolved import with the file and the line", async () => {
      const outcome = await buildPluginBrowser({
        pluginKey: "data:browser-broken",
        directory: join(fixtures, "browser-broken"),
        browserEntry: "src/browser.tsx",
      });

      assert.equal(outcome.kind, "failed");
      assert.ok(outcome.kind === "failed");
      assert.match(outcome.reason, /Could not resolve "\.\/missing-panel\.tsx"/);
      assert.match(outcome.reason, /src\/browser\.tsx:7:22/);
    });

    it("reports a syntax error with the file and the line", async () => {
      const directory = copyOfBrowsered();
      writeFileSync(
        join(directory, "src", "browser.tsx"),
        'export const label = "badge";\nexport const View = () => <div className={label} />;\nexport const broken = ;\n',
      );

      const outcome = await buildPluginBrowser({
        pluginKey: "data:browsered",
        directory,
        browserEntry: "src/browser.tsx",
      });

      assert.equal(outcome.kind, "failed");
      assert.ok(outcome.kind === "failed");
      assert.match(outcome.reason, /src\/browser\.tsx:3:/);
    });

    it("reports a missing stylesheet the same way as any other missing import", async () => {
      // Найдено живым прогоном: пока подмена пути шла без проверки существования, отсутствующий
      // `*.module.css` доезжал до `onLoad` и превращался в ENOENT со стеком по нашим модулям и по
      // внутренностям esbuild — вместо места импорта в исходнике плагина.
      const directory = copyOfBrowsered();
      writeFileSync(
        join(directory, "src", "browser.tsx"),
        'import styles from "./nowhere.module.css";\n\nexport const classNames = styles;\n',
      );

      const outcome = await buildPluginBrowser({
        pluginKey: "data:browsered",
        directory,
        browserEntry: "src/browser.tsx",
      });

      assert.equal(outcome.kind, "failed");
      assert.ok(outcome.kind === "failed");
      assert.match(outcome.reason, /Could not resolve "\.\/nowhere\.module\.css"/);
      assert.match(outcome.reason, /src\/browser\.tsx:1:/);
      assert.doesNotMatch(outcome.reason, /node_modules|plugin-browser-build/);
    });

    it("names an unavailable bundler apart from a broken plugin", async () => {
      // В артефакте сборщик приезжает в директорию данных после старта процесса, и его отсутствие
      // чинится установкой, а не правкой кода плагина (runtime-checks.md, проверка 37).
      //
      // Сборщик один на процесс, и уже загруженный побеждает любой источник: соседние проверки
      // выше его загрузили, поэтому здесь процесс возвращается в состояние «ещё не загружали».
      stopPluginBrowserBuilds();

      const outcome = await buildPluginBrowser({
        pluginKey: "data:browsered",
        directory: browsered,
        browserEntry: "src/browser.tsx",
        bundler: () => Promise.reject(new Error("Cannot find package 'esbuild'")),
      });

      assert.equal(outcome.kind, "failed");
      assert.ok(outcome.kind === "failed");
      assert.match(outcome.reason, /the browser bundler is not available/);
      assert.match(outcome.reason, /Cannot find package 'esbuild'/);

      // Неудачная загрузка не запоминается: следующая сборка берёт сборщик заново и собирает.
      const again = await buildPluginBrowser({
        pluginKey: "data:browsered",
        directory: browsered,
        browserEntry: "src/browser.tsx",
      });

      assert.equal(again.kind, "built");
    });

    it("does not reach for a missing entry point outside the plugin folder", async () => {
      const outcome = await buildPluginBrowser({
        pluginKey: "data:browsered",
        directory: browsered,
        browserEntry: "src/nowhere.tsx",
      });

      assert.equal(outcome.kind, "failed");
      assert.ok(outcome.kind === "failed");
      assert.match(outcome.reason, /nowhere\.tsx/);
    });
  });
});

/**
 * Импорт собранного бандла по вычисленному пути. Запрет на динамический импорт с невычислимым
 * адресом защищает границы областей демона (`eslint.config.js`), а здесь импортируется чужой
 * артефакт из временной папки: статическим такой импорт быть не может по определению.
 */
function importBuiltBundle(path: string): Promise<unknown> {
  // eslint-disable-next-line no-restricted-syntax
  return import(pathToFileURL(path).href);
}

let loaded = 0;

/**
 * Собранный бандл на диске: `import()` умеет только файл, а бандл живёт в памяти. Путь каждый раз
 * новый — иначе второй импорт того же содержимого достался бы из кеша модулей и ничего не исполнил.
 */
function writeBundle(bundle: PluginBrowserBundle): string {
  loaded += 1;
  const directory = join(workspace, `loaded-${loaded}`);
  mkdirSync(directory, { recursive: true });

  const path = join(directory, pluginBrowserFileNames.script);
  writeFileSync(path, bundle.files.get(pluginBrowserFileNames.script) ?? new Uint8Array());

  return path;
}
