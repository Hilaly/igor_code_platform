import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultConfig,
  defaultPreferences,
  interfaceScales,
  parseConfig,
  parsePreferences,
  type Preferences,
} from "./settings.ts";

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
    // `project:hello` — не ключ: у источника папки проекта частей три, и без идентификатора
    // проекта непонятно, чьей папке принадлежит плагин.
    const result = parsePreferences({
      plugins: { hello: { enabled: true }, "project:hello": { enabled: true } },
    });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.value.plugins : {}, {});
    assert.equal(result.diagnostics.length, 2);
  });

  it("keeps the decision about a plugin in a project folder", () => {
    // Ключ режется по последнему двоеточию: разбор по первому дал бы три части вместо двух и молча
    // выбросил бы решение человека о плагине проекта.
    const result = parsePreferences({
      plugins: {
        "project:b7Kq3xv9pQdT:hello": { enabled: true },
        "project:work:hello": { enabled: false },
      },
    });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.kind === "parsed" ? Object.keys(result.value.plugins) : [], [
      "project:b7Kq3xv9pQdT:hello",
      "project:work:hello",
    ]);
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

describe("parsePreferences: appearance and locale", () => {
  const parsed = (raw: unknown): Preferences => {
    const result = parsePreferences(raw);

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.diagnostics : ["unreachable"], []);

    return result.kind === "parsed" ? result.value : defaultPreferences;
  };

  it("takes a file that says nothing as the built-in scheme and the base locale", () => {
    assert.deepEqual(parsed({}).appearance, {
      colorScheme: "base",
      variant: "system",
      scale: "default",
    });
    assert.equal(parsed({}).locale, "en");
  });

  it("reads the scheme, the variant, the scale and the locale", () => {
    const preferences = parsed({
      appearance: { colorScheme: "midnight", variant: "dark", scale: "larger" },
      locale: "ru",
    });

    assert.deepEqual(preferences.appearance, {
      colorScheme: "midnight",
      variant: "dark",
      scale: "larger",
    });
    assert.equal(preferences.locale, "ru");
  });

  it("reads every step of the scale", () => {
    for (const scale of interfaceScales) {
      assert.equal(parsed({ appearance: { scale } }).appearance.scale, scale);
    }
  });

  it("fills in what the appearance does not name", () => {
    assert.deepEqual(parsed({ appearance: { variant: "light" } }), {
      plugins: {},
      appearance: { colorScheme: "base", variant: "light", scale: "default" },
      locale: "en",
    });
  });

  it("refuses the whole file when the appearance or the locale is wrong", () => {
    for (const raw of [
      { appearance: { variant: "bright" } },
      { appearance: { colorScheme: "" } },
      { appearance: { colorScheme: 7 } },
      { appearance: { scale: "huge" } },
      { appearance: { scale: 2 } },
      { appearance: "dark" },
      { locale: "не тег" },
      { locale: 7 },
    ]) {
      const result = parsePreferences(raw);

      assert.equal(result.kind, "rejected", `${JSON.stringify(raw)} must be refused`);
      assert.equal(result.diagnostics.length, 1, `${JSON.stringify(raw)} must say what is wrong`);
    }
  });

  it("keeps an unknown key inside the appearance as a diagnostic", () => {
    const result = parsePreferences({ appearance: { variant: "dark", contrast: "high" } });

    assert.equal(result.kind, "parsed");
    assert.match(result.diagnostics.join("\n"), /contrast/);
  });

  it("reports every section before refusing, so one run names all the problems", () => {
    const result = parsePreferences({
      pinned: true,
      plugins: { hello: { enabled: true } },
      locale: "не тег",
    });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join("\n"), /pinned/);
    assert.match(result.diagnostics.join("\n"), /hello/);
    assert.match(result.diagnostics.join("\n"), /locale/);
  });
});

describe("parseConfig", () => {
  const parsedConfig = (raw: unknown) => {
    const result = parseConfig(raw);

    assert.equal(result.kind, "parsed", result.kind === "rejected" ? result.diagnostics[0] : "");

    return result.kind === "parsed" ? result.value : defaultConfig;
  };

  it("takes an empty file as the defaults", () => {
    assert.deepEqual(parsedConfig({}), defaultConfig);
  });

  it("reads the limit of concurrent turns", () => {
    assert.equal(parsedConfig({ maxConcurrentTurns: 8 }).maxConcurrentTurns, 8);
  });

  it("refuses a limit that would let nothing run", () => {
    // Ноль остановил бы платформу целиком, и молчаливая подстановка умолчания это скрыла бы:
    // человек правил файл и обязан узнать, что правка не применена (docs/data-directory.md).
    for (const value of [0, -1, 2.5, "8", null]) {
      assert.equal(parseConfig({ maxConcurrentTurns: value }).kind, "rejected", String(value));
    }
  });
});
