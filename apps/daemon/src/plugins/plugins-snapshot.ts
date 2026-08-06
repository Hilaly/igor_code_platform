/**
 * Снимок состояния плагинов для веб-API (docs/event-bus.md). Собирается из тех же источников, что публикуют
 * события: статусы берутся у супервизора, вклады и ревизия — у реестра. Своего состояния здесь нет
 * намеренно — копия рассинхронизировалась бы с потоком, а догон по индексу опирается ровно на то,
 * что снимок и поток говорят одинаково.
 */

import {
  pluginsPath,
  type PluginPreferences,
  type PluginRouteConflict,
  type PluginsSnapshot,
} from "@sovereign/protocol";

import type { ContributionRegistry } from "./contribution-registry.ts";
import { respondWithJson, type Route } from "../http/public.ts";
import { resolvePluginEnablement } from "./plugin-enablement.ts";
import type { PluginSupervisor } from "./plugin-supervisor.ts";
import type { SettingsStore } from "../settings/public.ts";

export type PluginsSnapshotSources = {
  plugins: Pick<PluginSupervisor, "statuses">;
  registry: Pick<
    ContributionRegistry,
    "revision" | "pluginContributions" | "switchedOff" | "conflicts"
  >;
  /** Предпочтения нужны не как файл, а как решение: что из записанного действует прямо сейчас. */
  settings: Pick<SettingsStore, "current">;
};

export function pluginsRoute(sources: PluginsSnapshotSources): Route {
  return {
    method: "GET",
    path: pluginsPath,
    handle: ({ response }) => respondWithJson(response, 200, buildPluginsSnapshot(sources)),
  };
}

export function buildPluginsSnapshot(sources: PluginsSnapshotSources): PluginsSnapshot {
  const statuses = sources.plugins.statuses();
  const preferences = sources.settings.current().preferences;
  const enablement: Record<string, PluginPreferences> = {};

  for (const status of statuses) {
    // У плагина, отказанного до чтения манифеста, ключ — путь к папке: переключать там нечего.
    if (status.id === undefined) {
      continue;
    }

    const resolved = resolvePluginEnablement(status, preferences);

    enablement[status.key] = {
      enabled: resolved.enabled,
      disabledContributions: [...resolved.disabledContributions],
    };
  }

  const contributions = sources.registry.pluginContributions();

  return {
    revision: sources.registry.revision(),
    plugins: statuses,
    contributions,
    switchedOffContributions: sources.registry.switchedOff(),
    conflicts: sources.registry.conflicts(),
    routeConflicts: routeConflictsOf(contributions),
    enablement,
  };
}

function routeConflictsOf(contributions: PluginsSnapshot["contributions"]): PluginRouteConflict[] {
  const claims = new Map<
    string,
    { method: PluginRouteConflict["method"]; path: string; ids: string[] }
  >();

  for (const contribution of contributions) {
    if (
      contribution.ownership !== "plugin" ||
      (contribution.kind !== "route" && contribution.kind !== "public-route")
    ) {
      continue;
    }

    const path = pathShape(contribution.path);
    const key = `${contribution.method} ${contribution.pluginId} ${path}`;
    const existing = claims.get(key);
    if (existing === undefined) {
      claims.set(key, {
        method: contribution.method,
        path,
        ids: [contribution.id],
      });
    } else {
      existing.ids.push(contribution.id);
    }
  }

  return [...claims.values()]
    .filter((claim) => claim.ids.length > 1)
    .sort((left, right) =>
      `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`, "en"),
    )
    .map(({ method, path, ids }) => ({ method, path, contributions: ids }));
}

function pathShape(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? ":" : segment))
    .join("/");
}
