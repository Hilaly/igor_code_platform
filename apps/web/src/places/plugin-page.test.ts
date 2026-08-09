import type {
  PluginOwnedPageRegistration,
  PluginsSnapshot,
  PluginStatus,
} from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { resolvePluginPageState } from "./plugin-page.ts";

const placed: PluginStatus = {
  key: "data:placed",
  id: "placed",
  source: "data",
  directory: "/plugins/placed",
  state: "running",
  browser: { revision: "r1", entry: "/assets/placed-r1.js" },
};

const log: PluginOwnedPageRegistration = {
  ownership: "plugin",
  pluginKey: placed.key,
  pluginId: "placed",
  source: "data",
  kind: "page",
  id: "placed.log",
  declaredId: "log",
  title: "Log",
  export: "LogPage",
};

const snapshot = (parts: Partial<PluginsSnapshot> = {}): PluginsSnapshot => ({
  revision: 1,
  plugins: [placed],
  contributions: [log],
  switchedOffContributions: [],
  conflicts: [],
  routeConflicts: [],
  enablement: {},
  ...parts,
});

describe("resolvePluginPageState", () => {
  it("opens a declared page", () => {
    expect(resolvePluginPageState(snapshot(), "placed", "log")).toEqual({
      kind: "open",
      registration: log,
      status: placed,
    });
  });

  it("waits while the snapshot has not arrived", () => {
    expect(resolvePluginPageState(undefined, "placed", "log")).toEqual({ kind: "waiting" });
  });

  /** Выключенный вклад оставляет адрес живым: включение возвращает страницу на тот же URL. */
  it("calls a switched-off contribution switched off, not missing", () => {
    const state = resolvePluginPageState(
      snapshot({ contributions: [], switchedOffContributions: [log] }),
      "placed",
      "log",
    );

    expect(state).toEqual({ kind: "switched-off" });
  });

  it("calls a switched-off plugin switched off, though it has no contributions at all", () => {
    const state = resolvePluginPageState(
      snapshot({ contributions: [], plugins: [{ ...placed, state: "disabled" }] }),
      "placed",
      "log",
    );

    expect(state).toEqual({ kind: "switched-off" });
  });

  /** Сборка ещё идёт — это ожидание, а не отказ: ловушка, пойманная живой проверкой среза 12b-2. */
  it("waits while the plugin is still building", () => {
    const state = resolvePluginPageState(
      snapshot({
        contributions: [],
        plugins: [{ ...placed, state: "building", browser: undefined }],
      }),
      "placed",
      "log",
    );

    expect(state).toEqual({ kind: "waiting" });
  });

  it("reports a failed plugin with the reason it failed", () => {
    const state = resolvePluginPageState(
      snapshot({
        contributions: [],
        plugins: [{ ...placed, state: "failed", reason: "the bundle does not build" }],
      }),
      "placed",
      "log",
    );

    expect(state).toEqual({ kind: "failed", reason: "the bundle does not build" });
  });

  it("takes an address no plugin declares for a missing page", () => {
    expect(resolvePluginPageState(snapshot(), "placed", "board")).toEqual({ kind: "missing" });
    expect(resolvePluginPageState(snapshot(), "rival", "log")).toEqual({ kind: "missing" });
  });

  /**
   * Адрес страницы один на всё окно, поэтому копия плагина в папке проекта его не занимает: окно
   * рисуется и тогда, когда не открыт ни один проект.
   */
  it("does not open a page declared by a plugin from a project folder", () => {
    const project = {
      ...log,
      pluginKey: "project:work:placed",
      source: "project:work" as const,
    };
    const state = resolvePluginPageState(
      snapshot({
        contributions: [project],
        plugins: [{ ...placed, key: project.pluginKey, source: project.source }],
      }),
      "placed",
      "log",
    );

    expect(state).toEqual({ kind: "missing" });
  });
});
