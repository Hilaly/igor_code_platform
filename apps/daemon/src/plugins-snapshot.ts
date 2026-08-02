/**
 * Снимок состояния плагинов для веб-API (docs/event-bus.md). Собирается из тех же источников, что публикуют
 * события: статусы берутся у супервизора, вклады и ревизия — у реестра. Своего состояния здесь нет
 * намеренно — копия рассинхронизировалась бы с потоком, а догон по индексу опирается ровно на то,
 * что снимок и поток говорят одинаково.
 */

import { pluginsPath, type PluginPreferences, type PluginsSnapshot } from "@sovereign/protocol";

import type { ContributionRegistry } from "./contribution-registry.ts";
import { respondWithJson, type Route } from "./http/public.ts";
import { resolvePluginEnablement } from "./plugin-enablement.ts";
import type { PluginSupervisor } from "./plugin-supervisor.ts";
import type { SettingsStore } from "./settings/public.ts";

export type PluginsSnapshotSources = {
  plugins: Pick<PluginSupervisor, "statuses">;
  registry: Pick<ContributionRegistry, "revision" | "resolved" | "switchedOff" | "conflicts">;
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

  return {
    revision: sources.registry.revision(),
    plugins: statuses,
    contributions: sources.registry.resolved(),
    switchedOffContributions: sources.registry.switchedOff(),
    conflicts: sources.registry.conflicts(),
    enablement,
  };
}
