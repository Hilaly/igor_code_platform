import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPluginSource,
  matchVersionRange,
  parsePluginManifest,
  platformVersion,
  pluginEnabledByDefault,
  pluginSourceRank,
  projectOfPluginSource,
  projectPluginSource,
  type PluginManifestParseResult,
} from "./plugin.ts";

const validManifest = (overrides: Record<string, unknown> = {}): unknown => ({
  name: "hello",
  version: "1.0.0",
  sovereign: { id: "hello", worker: "src/worker.ts", platform: "*", ...overrides },
});

const parsedValue = (result: PluginManifestParseResult) => {
  assert.equal(result.kind, "parsed");

  return result.kind === "parsed" ? result.value : undefined;
};

describe("parsePluginManifest", () => {
  it("reads the sovereign field of package.json", () => {
    const result = parsePluginManifest(validManifest({ browser: "src/browser.tsx" }));

    assert.deepEqual(parsedValue(result), {
      id: "hello",
      worker: "src/worker.ts",
      browser: "src/browser.tsx",
      platform: "*",
    });
  });

  it("treats a package without the sovereign field as not a plugin", () => {
    const result = parsePluginManifest({ name: "some-package", version: "1.0.0" });

    assert.equal(result.kind, "absent");
  });

  it("refuses a package.json that is not an object", () => {
    const result = parsePluginManifest("not a manifest");

    assert.equal(result.kind, "refused");
  });

  it("keeps an unknown key as a diagnostic and takes the plugin", () => {
    const result = parsePluginManifest(validManifest({ future: true }));

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.diagnostics : [], [
      "sovereign.future is unknown and ignored",
    ]);
  });

  it("refuses identifiers that cannot go into a route", () => {
    for (const id of ["", "Hello", "hello world", "-hello", "@scope/hello", 42]) {
      const result = parsePluginManifest(validManifest({ id }));

      assert.equal(result.kind, "refused", `identifier ${JSON.stringify(id)} must be refused`);
    }
  });

  it("reserves the core namespace for the host", () => {
    const result = parsePluginManifest(validManifest({ id: "core" }));

    assert.equal(result.kind, "refused");
    assert.equal(
      result.kind === "refused" ? result.reason : "",
      "sovereign.id core is reserved for the host",
    );
  });

  it("refuses a missing entry point", () => {
    const result = parsePluginManifest(validManifest({ worker: undefined }));

    assert.equal(result.kind, "refused");
  });

  it("refuses an entry point that leaves the plugin folder", () => {
    for (const worker of ["../outside.ts", "/etc/passwd", "src/../../outside.ts"]) {
      const result = parsePluginManifest(validManifest({ worker }));

      assert.equal(result.kind, "refused", `entry point ${worker} must be refused`);
    }
  });

  it("refuses an incompatible platform version with a readable reason", () => {
    const result = parsePluginManifest(validManifest({ platform: "^9.0.0" }), "0.1.0");

    assert.equal(result.kind, "refused");
    assert.equal(
      result.kind === "refused" ? result.reason : "",
      "the plugin requires platform ^9.0.0, this platform is 0.1.0",
    );
  });

  it("refuses a range it cannot read instead of assuming it fits", () => {
    for (const platform of [">=1.0.0 <2.0.0", "1.x", "latest", "1.0.0-beta.1", ""]) {
      const result = parsePluginManifest(validManifest({ platform }));

      assert.equal(result.kind, "refused", `range ${JSON.stringify(platform)} must be refused`);
    }
  });

  it("checks the range against the current platform version by default", () => {
    const result = parsePluginManifest(validManifest({ platform: platformVersion }));

    assert.equal(result.kind, "parsed");
  });
});

describe("matchVersionRange", () => {
  const cases: [range: string, version: string, expected: string][] = [
    ["*", "0.1.0", "matches"],
    ["0.1.0", "0.1.0", "matches"],
    ["0.1.0", "0.1.1", "differs"],
    ["^1.2.0", "1.9.0", "matches"],
    ["^1.2.0", "1.1.0", "differs"],
    ["^1.2.0", "2.0.0", "differs"],
    // На нулевом мажоре ломающим считается минор — как в npm.
    ["^0.1.0", "0.1.7", "matches"],
    ["^0.1.0", "0.2.0", "differs"],
    ["^0.0.3", "0.0.3", "matches"],
    ["^0.0.3", "0.0.4", "differs"],
    ["~1.2.0", "1.2.9", "matches"],
    ["~1.2.0", "1.3.0", "differs"],
    [">=1.2.0", "9.0.0", "matches"],
    [">=1.2.0", "1.1.9", "differs"],
    ["  ^1.2.0  ", "1.3.0", "matches"],
  ];

  for (const [range, version, expected] of cases) {
    it(`${range} against ${version} is ${expected}`, () => {
      assert.equal(matchVersionRange(range, version).kind, expected);
    });
  }
});

describe("plugin sources", () => {
  it("ranks the project folder above the data directory and both above builtin", () => {
    // Ранг — это специфичность: более частный источник перекрывает менее частный
    // (docs/plugins.md). Считать его позицией в массиве нельзя — источник проекта
    // параметризован, и `indexOf` дал бы ему −1, то есть проигрыш встроенному.
    assert.ok(pluginSourceRank("builtin") < pluginSourceRank("data"));
    assert.ok(pluginSourceRank("data") < pluginSourceRank(projectPluginSource("b7Kq3xv9pQdT")));
  });

  it("builds and reads back the source of a project folder", () => {
    const source = projectPluginSource("b7Kq3xv9pQdT");

    assert.equal(source, "project:b7Kq3xv9pQdT");
    assert.equal(projectOfPluginSource(source), "b7Kq3xv9pQdT");
    assert.equal(projectOfPluginSource("data"), undefined);
    assert.equal(projectOfPluginSource("builtin"), undefined);
  });

  it("recognises the sources it knows and refuses the rest", () => {
    for (const source of ["builtin", "data", "project:work", "project:b7Kq3xv9pQdT"]) {
      assert.ok(isPluginSource(source), `${source} must be a source`);
    }

    for (const source of ["", "project:", "project", "sneaky", "project:a:b", 1, null]) {
      assert.ok(!isPluginSource(source), `${JSON.stringify(source)} must not be a source`);
    }
  });

  it("enables only the builtin source without asking", () => {
    // Включение — граница доверия (docs/plugins.md): код из папки проекта ждёт явного «да».
    assert.equal(pluginEnabledByDefault("builtin"), true);
    assert.equal(pluginEnabledByDefault("data"), false);
    assert.equal(pluginEnabledByDefault(projectPluginSource("work")), false);
  });
});
