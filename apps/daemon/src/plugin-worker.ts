/**
 * Бутстрап воркера плагина: единственный код платформы, который исполняется рядом с чужим кодом.
 * Порядок обязателен (ADR-0043): сначала хэндл хоста, потом импорт плагина. Плагин, импортированный
 * раньше, увидит SDK без хоста на первом же вызове верхнего уровня.
 *
 * Воркеру нужен `--experimental-transform-types`, и флаг ставится только ему (ADR-0004): автор
 * плагина вправе писать `enum` и `namespace`, платформа — нет.
 */

import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

import { installPluginHost } from "@sovereign/sdk/host";
import type { PluginModule } from "@sovereign/sdk";

import type { PluginIncoming, PluginOutgoing, PluginWorkerData } from "./plugin-wire.ts";

const port = parentPort;

if (port === null) {
  throw new Error("The plugin bootstrap runs inside a worker and needs a parent port.");
}

const data = workerData as PluginWorkerData;

const send = (message: PluginOutgoing): void => port.postMessage(message);

const describe = (cause: unknown): string =>
  cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);

installPluginHost({
  identity: { id: data.id, source: data.source },
  log: async (level, message, fields) => {
    send(
      fields === undefined
        ? { kind: "log", level, message }
        : { kind: "log", level, message, fields },
    );
  },
  contribute: async (contribution) => {
    send({ kind: "contribute", contribution });
  },
});

let plugin: PluginModule | undefined;

try {
  const loaded: unknown = await import(pathToFileURL(data.workerEntry).href);

  if (typeof (loaded as PluginModule).activate !== "function") {
    throw new Error("the plugin does not export activate()");
  }

  plugin = loaded as PluginModule;

  await plugin.activate();
  send({ kind: "activated" });
} catch (cause) {
  // Воркер не снимает себя сам: снимает ядро, чтобы момент смерти был один и наблюдаемый.
  send({ kind: "failed", reason: describe(cause) });
}

port.on("message", (message: PluginIncoming) => {
  if (message.kind !== "deactivate") {
    return;
  }

  void (async () => {
    try {
      await plugin?.deactivate?.();
      send({ kind: "deactivated" });
    } catch (cause) {
      // Сломанный deactivate не отменяет выгрузку: ядру важно, что она закончилась.
      send({ kind: "deactivated", problem: describe(cause) });
    }
  })();
});
