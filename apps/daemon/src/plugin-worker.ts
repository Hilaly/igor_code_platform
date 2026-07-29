/**
 * Бутстрап воркера плагина: единственный код платформы, который исполняется рядом с чужим кодом.
 * Порядок обязателен (docs/plugins.md): сначала хэндл хоста, потом импорт плагина. Плагин, импортированный
 * раньше, увидит SDK без хоста на первом же вызове верхнего уровня.
 *
 * Воркеру нужен `--experimental-transform-types`, и флаг ставится только ему (docs/toolchain.md): автор
 * плагина вправе писать `enum` и `namespace`, платформа — нет.
 */

import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

import { deliverEvent } from "@sovereign/sdk/events";
import { installPluginHost } from "@sovereign/sdk/host";
import type { PluginModule, ProviderResponse } from "@sovereign/sdk";

import type { PluginIncoming, PluginOutgoing, PluginWorkerData } from "./plugin-wire.ts";

const port = parentPort;

if (port === null) {
  throw new Error("The plugin bootstrap runs inside a worker and needs a parent port.");
}

const data = workerData as PluginWorkerData;

const send = (message: PluginOutgoing): void => port.postMessage(message);

const describe = (cause: unknown): string =>
  cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);

/**
 * Единственная пара «запрос-ответ» в канале (docs/models-and-providers.md). Счётчик локален для
 * воркера: ядро отвечает тому же воркеру, из которого пришёл запрос, поэтому глобальная
 * уникальность идентификатора не нужна.
 */
const awaitingAnswer = new Map<string, (response: ProviderResponse) => void>();
let requestsSent = 0;

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
  publishEvent: async (declaredId, payload) => {
    send({ kind: "publish", declaredId, payload });
  },
  subscribeEvent: async (type) => {
    send({ kind: "subscribe", type });
  },
  unsubscribeEvent: async (type) => {
    send({ kind: "unsubscribe", type });
  },
  providers: (request) =>
    new Promise((resolve) => {
      requestsSent += 1;

      const requestId = String(requestsSent);

      awaitingAnswer.set(requestId, resolve);
      send({ kind: "request", requestId, request });
    }),
});

let plugin: PluginModule | undefined;

/**
 * Слушатель ставится **до** запуска плагина, а не после: `activate` вправе спросить платформу о
 * провайдерах и ждать ответа, а ответ приходит этим же портом. Со слушателем, стоящим после, воркер
 * висел бы на собственном `await` до самой смерти.
 */
port.on("message", (message: PluginIncoming) => {
  if (message.kind === "event") {
    // Доставка асинхронна и ответа не имеет: ядро не ждёт обработчик плагина (docs/event-bus.md).
    void deliverEvent(message.type, message.payload, message.plugin);

    return;
  }

  if (message.kind === "response") {
    const waiting = awaitingAnswer.get(message.requestId);
    awaitingAnswer.delete(message.requestId);
    waiting?.(message.response);

    return;
  }

  void (async () => {
    try {
      // Выгрузка ждёт конца запуска: `deactivate` посреди `activate` убирал бы то, чего плагин
      // ещё не завёл. Ядро на этот случай держит свой таймаут (docs/plugins.md).
      await started;
      await plugin?.deactivate?.();
      send({ kind: "deactivated" });
    } catch (cause) {
      // Сломанный deactivate не отменяет выгрузку: ядру важно, что она закончилась.
      send({ kind: "deactivated", problem: describe(cause) });
    }
  })();
});

const started = (async () => {
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
})();
