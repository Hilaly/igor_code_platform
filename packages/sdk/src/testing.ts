/**
 * Тестовый шов (ADR-0043): плагин обязан проверяться без поднятого демона. Шов подставляет
 * фальшивый хост и записывает всё, что плагин через него сказал.
 *
 * Порядок обязателен: сначала шов, потом `await import()` плагина. Импорт до установки шва — это
 * плагин, у которого при первом же вызове нет хоста.
 */

import {
  installPluginHost,
  removePluginHost,
  type PluginContribution,
  type PluginIdentity,
  type PluginLogLevel,
} from "./host.ts";

export type RecordedLog = {
  level: PluginLogLevel;
  message: string;
  fields?: Record<string, unknown>;
};

export type PluginTestHost = {
  identity: PluginIdentity;
  logs: RecordedLog[];
  contributions: PluginContribution[];
  /** Снимает шов. Без этого следующий тест увидит чужой хост. */
  restore: () => void;
};

export function installTestHost(identity: Partial<PluginIdentity> = {}): PluginTestHost {
  const resolved: PluginIdentity = {
    id: identity.id ?? "test-plugin",
    source: identity.source ?? "data",
  };
  const logs: RecordedLog[] = [];
  const contributions: PluginContribution[] = [];

  installPluginHost({
    identity: resolved,
    log: async (level, message, fields) => {
      logs.push(fields === undefined ? { level, message } : { level, message, fields });
    },
    contribute: async (contribution) => {
      contributions.push(contribution);
    },
  });

  return { identity: resolved, logs, contributions, restore: removePluginHost };
}
