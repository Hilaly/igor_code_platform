/**
 * Снимок состояния плагинов для веб-API (ADR-0041). Собирается из тех же источников, что публикуют
 * события: статусы берутся у супервизора, вклады и ревизия — у реестра. Своего состояния здесь нет
 * намеренно — копия рассинхронизировалась бы с потоком, а догон по индексу опирается ровно на то,
 * что снимок и поток говорят одинаково.
 */

import { pluginsPath, type PluginsSnapshot } from "@sovereign/protocol";

import type { ContributionRegistry } from "./contribution-registry.ts";
import { respondWithJson, type Route } from "./dispatcher.ts";
import type { PluginSupervisor } from "./plugin-supervisor.ts";

export type PluginsSnapshotSources = {
  plugins: Pick<PluginSupervisor, "statuses">;
  registry: Pick<ContributionRegistry, "revision" | "resolved">;
};

export function pluginsRoute(sources: PluginsSnapshotSources): Route {
  return {
    method: "GET",
    path: pluginsPath,
    handle: ({ response }) => respondWithJson(response, 200, buildPluginsSnapshot(sources)),
  };
}

export function buildPluginsSnapshot(sources: PluginsSnapshotSources): PluginsSnapshot {
  return {
    revision: sources.registry.revision(),
    plugins: sources.plugins.statuses(),
    contributions: sources.registry.resolved(),
  };
}
