/**
 * Что именно платформа должна поднять: обнаруженные плагины, наложенные на предпочтения человека.
 * Отдельно от обнаружения и от супервизора, потому что это правило, а не действие: обнаружение
 * говорит, что лежит на диске, супервизор — что уже запущено, а здесь решается, что должно быть.
 */

import { pluginEnabledByDefault, type Preferences } from "@sovereign/protocol";

import type { DiscoveredPlugin } from "./plugin-sources.ts";

export type PluginEnablement = {
  enabled: boolean;
  /** Пустое множество не значит «вклады не выключены»: у плагина их может не быть вовсе. */
  disabledContributions: ReadonlySet<string>;
};

export function resolvePluginEnablement(
  plugin: Pick<DiscoveredPlugin, "key" | "source">,
  preferences: Preferences,
): PluginEnablement {
  const stated = preferences.plugins[plugin.key];

  if (stated === undefined) {
    return {
      enabled: pluginEnabledByDefault(plugin.source),
      disabledContributions: new Set(),
    };
  }

  return {
    enabled: stated.enabled,
    disabledContributions: new Set(stated.disabledContributions),
  };
}
