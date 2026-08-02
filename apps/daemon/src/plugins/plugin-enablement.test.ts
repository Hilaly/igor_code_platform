import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultPreferences, type Preferences } from "@sovereign/protocol";

import { resolvePluginEnablement } from "./plugin-enablement.ts";

const builtin = { key: "builtin:tasks", source: "builtin" } as const;
const external = { key: "data:hello", source: "data" } as const;

const preferences = (plugins: Preferences["plugins"]): Preferences => ({
  ...defaultPreferences,
  plugins,
});

describe("resolvePluginEnablement", () => {
  it("runs a built-in plugin nobody has decided about", () => {
    assert.equal(resolvePluginEnablement(builtin, defaultPreferences).enabled, true);
  });

  it("keeps an unseen external plugin off until it is enabled by hand", () => {
    assert.equal(resolvePluginEnablement(external, defaultPreferences).enabled, false);
  });

  it("lets the human turn a built-in plugin off", () => {
    const stated = preferences({ "builtin:tasks": { enabled: false, disabledContributions: [] } });

    assert.equal(resolvePluginEnablement(builtin, stated).enabled, false);
  });

  it("lets the human turn an external plugin on", () => {
    const stated = preferences({ "data:hello": { enabled: true, disabledContributions: [] } });

    assert.equal(resolvePluginEnablement(external, stated).enabled, true);
  });

  it("takes the decision for the overriding copy separately", () => {
    const stated = preferences({ "data:hello": { enabled: true, disabledContributions: [] } });

    assert.equal(
      resolvePluginEnablement({ key: "builtin:hello", source: "builtin" }, stated).enabled,
      true,
    );
    assert.equal(resolvePluginEnablement(external, stated).enabled, true);
  });

  it("carries the disabled contributions of the plugin", () => {
    const stated = preferences({
      "data:hello": { enabled: true, disabledContributions: ["hello.board"] },
    });

    const enablement = resolvePluginEnablement(external, stated);

    assert.equal(enablement.disabledContributions.has("hello.board"), true);
    assert.equal(enablement.disabledContributions.has("hello.panel"), false);
  });
});
