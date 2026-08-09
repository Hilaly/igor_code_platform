import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultAppearance,
  defaultConfig,
  defaultPreferences,
  builtInColorScheme,
  configKeys,
  interfaceScales,
  parseConfig,
  parseConfigUpdate,
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

  it("takes a file that says nothing as the Imperium scheme and the base locale", () => {
    assert.deepEqual(parsed({}).appearance, {
      colorScheme: "imperium",
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
      appearance: { colorScheme: "imperium", variant: "light", scale: "default" },
      locale: "en",
    });
  });

  it("uses Imperium as the built-in appearance", () => {
    assert.equal(builtInColorScheme, "imperium");
    assert.equal(defaultAppearance.colorScheme, "imperium");
    assert.equal(defaultPreferences.appearance.colorScheme, "imperium");
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

  it("reads the two waits of a plugin separately", () => {
    // Величины разные по природе: хук ждут внутри турна, инструмент модель зовёт как работу
    // (docs/hooks.md). Одно значение на оба заставило бы поднять и то, которое держит турн.
    const value = parsedConfig({ hookTimeoutMilliseconds: 800, pluginToolTimeoutMilliseconds: 30 });

    assert.equal(value.hookTimeoutMilliseconds, 800);
    assert.equal(value.pluginToolTimeoutMilliseconds, 30);
    assert.equal(defaultConfig.hookTimeoutMilliseconds, 5000);
    assert.equal(defaultConfig.pluginToolTimeoutMilliseconds, 120000);
  });

  it("reads the three limits of a plugin route", () => {
    // Единственная поверхность платформы, открытая наружу, настраивается под свой случай, а не под
    // наш: вебхук приносит нагрузку чужого сервиса и зовётся с чужой частотой (docs/web-api.md).
    const value = parsedConfig({
      pluginRouteTimeoutMilliseconds: 5000,
      pluginRouteBodyLimitBytes: 4096,
      publicRouteRequestsPerMinute: 5,
    });

    assert.equal(value.pluginRouteTimeoutMilliseconds, 5000);
    assert.equal(value.pluginRouteBodyLimitBytes, 4096);
    assert.equal(value.publicRouteRequestsPerMinute, 5);
    assert.equal(defaultConfig.pluginRouteTimeoutMilliseconds, 30000);
    assert.equal(defaultConfig.pluginRouteBodyLimitBytes, 1048576);
    assert.equal(defaultConfig.publicRouteRequestsPerMinute, 60);
  });

  it("refuses a wait that is not a positive whole number of milliseconds", () => {
    for (const key of [
      "hookTimeoutMilliseconds",
      "pluginToolTimeoutMilliseconds",
      "pluginRouteTimeoutMilliseconds",
      "pluginRouteBodyLimitBytes",
      "publicRouteRequestsPerMinute",
    ]) {
      for (const value of [0, -1, 1.5, "500", null]) {
        assert.equal(parseConfig({ [key]: value }).kind, "rejected", `${key}=${String(value)}`);
      }
    }
  });
});

describe("parseConfigUpdate", () => {
  it("names every key of the config, so none of them is unreachable from the interface", () => {
    // Ключ, забытый в `configKeys`, попал бы в незнакомые и молча игнорировался при записи.
    assert.deepEqual([...configKeys].sort(), Object.keys(defaultConfig).sort());
  });

  it("accepts one known configuration key", () => {
    assert.deepEqual(parseConfigUpdate({ maxConcurrentTurns: 8 }), {
      kind: "parsed",
      value: { maxConcurrentTurns: 8 },
      diagnostics: [],
    });
  });

  it("takes a legacy document that names all the keys", () => {
    const result = parseConfigUpdate({ ...defaultConfig, maxConcurrentTurns: 8 });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      ...defaultConfig,
      maxConcurrentTurns: 8,
    });
  });

  it("refuses an empty update", () => {
    const result = parseConfigUpdate({});

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join("; "), /at least one.*key is required/);
  });

  it("refuses an update that names no known configuration key", () => {
    const result = parseConfigUpdate({ futureKey: 1 });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join("; "), /at least one known key is required/);
  });

  it("refuses a wrong value the same way reading the file does", () => {
    const result = parseConfigUpdate({ publicRouteRequestsPerMinute: 0 });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join("; "), /publicRouteRequestsPerMinute must be an integer/);
  });

  it("keeps an unknown key as a diagnostic instead of refusing", () => {
    // Тот же довод, что и при чтении файла: понижение версии платформы не обязано ломать форму.
    const result = parseConfigUpdate({ maxConcurrentTurns: 8, futureKey: 1 });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      maxConcurrentTurns: 8,
      futureKey: 1,
    });
    assert.match(result.diagnostics.join("; "), /unknown key "futureKey" is ignored/);
  });

  it("refuses a body that is not an object", () => {
    assert.equal(parseConfigUpdate([]).kind, "rejected");
    assert.equal(parseConfigUpdate("info").kind, "rejected");
  });
});
