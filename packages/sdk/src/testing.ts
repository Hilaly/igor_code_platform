/**
 * Тестовый шов (ADR-0043): плагин обязан проверяться без поднятого демона. Шов подставляет
 * фальшивый хост и записывает всё, что плагин через него сказал.
 *
 * Порядок обязателен: сначала шов, потом `await import()` плагина. Импорт до установки шва — это
 * плагин, у которого при первом же вызове нет хоста.
 */

import { clearEventHandlers, deliverEvent, type EventOrigin } from "./events.ts";
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

/** Имя объявленное, без неймспейса: неймспейс ставит настоящий хост, и в тесте его нет. */
export type RecordedEvent = {
  declaredId: string;
  payload: unknown;
};

export type PluginTestHost = {
  identity: PluginIdentity;
  logs: RecordedLog[];
  contributions: PluginContribution[];
  published: RecordedEvent[];
  /** Имена, на которые плагин подписался: их и знает настоящее ядро. */
  subscriptions: string[];
  /** Доставить событие подписчику — то, что в живой платформе делает ядро. */
  deliver: (type: string, payload: unknown, origin?: EventOrigin) => Promise<void>;
  /** Снимает шов и подписки. Без этого следующий тест увидит чужой хост. */
  restore: () => void;
};

export function installTestHost(identity: Partial<PluginIdentity> = {}): PluginTestHost {
  const resolved: PluginIdentity = {
    id: identity.id ?? "test-plugin",
    source: identity.source ?? "data",
  };
  const logs: RecordedLog[] = [];
  const contributions: PluginContribution[] = [];
  const published: RecordedEvent[] = [];
  const subscriptions: string[] = [];

  installPluginHost({
    identity: resolved,
    log: async (level, message, fields) => {
      logs.push(fields === undefined ? { level, message } : { level, message, fields });
    },
    contribute: async (contribution) => {
      contributions.push(contribution);
    },
    publishEvent: async (declaredId, payload) => {
      published.push({ declaredId, payload });
    },
    subscribeEvent: async (type) => {
      subscriptions.push(type);
    },
    unsubscribeEvent: async (type) => {
      const index = subscriptions.indexOf(type);

      if (index >= 0) {
        subscriptions.splice(index, 1);
      }
    },
  });

  return {
    identity: resolved,
    logs,
    contributions,
    published,
    subscriptions,
    deliver: deliverEvent,
    restore: () => {
      clearEventHandlers();
      removePluginHost();
    },
  };
}
