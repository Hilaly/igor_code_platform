import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePreferences, type Preferences } from "./settings.ts";

const parsedPlugins = (raw: unknown): Preferences["plugins"] => {
  const result = parsePreferences(raw);

  assert.equal(result.kind, "parsed");

  return result.kind === "parsed" ? result.value.plugins : {};
};

describe("parsePreferences", () => {
  it("takes an empty file as nothing decided", () => {
    assert.deepEqual(parsedPlugins({}), {});
  });

  it("reads enablement and disabled contributions keyed by source and identifier", () => {
    const plugins = parsedPlugins({
      plugins: {
        "builtin:tasks": { enabled: false },
        "data:hello": { enabled: true, disabledContributions: ["hello.board"] },
      },
    });

    assert.deepEqual(plugins, {
      "builtin:tasks": { enabled: false, disabledContributions: [] },
      "data:hello": { enabled: true, disabledContributions: ["hello.board"] },
    });
  });

  it("takes a named plugin as enabled: naming it says something", () => {
    const plugins = parsedPlugins({ plugins: { "data:hello": { disabledContributions: [] } } });

    assert.equal(plugins["data:hello"]?.enabled, true);
  });

  it("ignores a key that is not <source>:<id> and says so", () => {
    const result = parsePreferences({
      plugins: { hello: { enabled: true }, "project:hello": { enabled: true } },
    });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.value.plugins : {}, {});
    assert.equal(result.diagnostics.length, 2);
  });

  it("refuses the whole file when a value is wrong", () => {
    for (const entry of [
      { enabled: "yes" },
      { disabledContributions: "hello.board" },
      "enabled",
      [],
    ]) {
      const result = parsePreferences({ plugins: { "data:hello": entry } });

      assert.equal(result.kind, "rejected", `entry ${JSON.stringify(entry)} must be refused`);
    }
  });

  it("refuses plugins that is not an object", () => {
    assert.equal(parsePreferences({ plugins: [] }).kind, "rejected");
  });

  it("keeps an unknown key inside an entry as a diagnostic", () => {
    const result = parsePreferences({
      plugins: { "data:hello": { enabled: true, pinned: true } },
    });

    assert.equal(result.kind, "parsed");
    assert.match(result.diagnostics.join("\n"), /pinned/);
  });
});
