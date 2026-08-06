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
import { invokeHookHandler } from "@sovereign/sdk/hooks";
import { invokeRoute } from "@sovereign/sdk/routes";
import { invokeTool } from "@sovereign/sdk/tools";
import type {
  LoginDialogue,
  LoginStep,
  PluginModule,
  ProviderResponse,
  SessionResponse,
  StorageResponse,
} from "@sovereign/sdk";

import type {
  PluginCall,
  PluginCallResult,
  PluginIncoming,
  PluginOutgoing,
  PluginResponse,
  PluginWorkerData,
} from "./plugin-wire.ts";

const port = parentPort;

if (port === null) {
  throw new Error("The plugin bootstrap runs inside a worker and needs a parent port.");
}

const data = workerData as PluginWorkerData;

const send = (message: PluginOutgoing): void => port.postMessage(message);

const describe = (cause: unknown): string =>
  cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);

/**
 * Пара «воркер спрашивает ядро» (docs/models-and-providers.md). Счётчик локален для воркера: ядро
 * отвечает тому же воркеру, из которого пришёл запрос, поэтому глобальная уникальность
 * идентификатора не нужна.
 */
const awaitingAnswer = new Map<string, (response: PluginResponse) => void>();
let requestsSent = 0;

const nextRequestId = (): string => {
  requestsSent += 1;

  return String(requestsSent);
};

/**
 * Диалоги идущих входов по идентификатору вызова. Диалог остаётся здесь и границу не пересекает: в
 * нём функции, а граница воркера — структурное клонирование (docs/models-and-providers.md).
 */
const loginDialogues = new Map<string, LoginDialogue>();

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
      const requestId = nextRequestId();

      // Ответ приезжает объединением обоих каналов; разбирает его тот, кто спрашивал: вид ответа
      // задаётся видом запроса, и чужой вид для вызывающего — ошибка платформы, а не его дело.
      awaitingAnswer.set(requestId, (response) => resolve(response as ProviderResponse));
      send({ kind: "request", requestId, request });
    }),
  sessions: (request) =>
    new Promise((resolve) => {
      const requestId = nextRequestId();

      awaitingAnswer.set(requestId, (response) => resolve(response as SessionResponse));
      send({ kind: "request", requestId, request });
    }),
  storage: (request) =>
    new Promise((resolve) => {
      const requestId = nextRequestId();

      awaitingAnswer.set(requestId, (response) => resolve(response as StorageResponse));
      send({ kind: "request", requestId, request });
    }),
  login: (input) =>
    new Promise((resolve, reject) => {
      const requestId = nextRequestId();

      loginDialogues.set(requestId, input.dialogue);
      awaitingAnswer.set(requestId, (response) => {
        loginDialogues.delete(requestId);

        if (response.kind === "login") {
          resolve(response.conclusion);

          return;
        }

        reject(
          new Error(
            response.kind === "failed"
              ? response.reason
              : `the platform answered ${response.kind} to a login request`,
          ),
        );
      });
      send({
        kind: "request",
        requestId,
        request: { kind: "login", providerId: input.providerId, method: input.method },
      });
    }),
});

/**
 * Провести один шаг диалога. Ответ уезжает тем же `requestId`, что и сам вызов входа: шаг — часть
 * контракта операции, и отвечать на него имеет право только тот, кто её начал.
 */
const walkLoginStep = async (requestId: string, step: LoginStep): Promise<void> => {
  const dialogue = loginDialogues.get(requestId);

  // Диалога уже нет: вход кончился, а шаг разъехался с концом. Отвечать некому и незачем.
  if (dialogue === undefined) {
    return;
  }

  if (step.kind === "notice") {
    dialogue.tell?.(step.notice);

    return;
  }

  const prompt = step.prompt;

  try {
    send({
      kind: "login-answer",
      requestId,
      stepId: prompt.stepId,
      value: await dialogue.ask(prompt),
    });
  } catch (cause) {
    // Плагин отказался отвечать — это отмена входа, а не поломка канала. Причина всё равно уходит
    // в журнал: молча проглоченный отказ выглядел бы как зависший вход.
    send({
      kind: "log",
      level: "warn",
      message: "the plugin did not answer a login step and the login was cancelled",
      fields: { reason: describe(cause) },
    });
    send({ kind: "login-cancel", requestId });
  }
};

/**
 * Отказ решающего хука в словаре SDK — `{ refuse: причина }`. Перевод в вид канала делается здесь, а
 * не у диспетчера: иначе каждый, кто зовёт хук, разбирал бы форму значения сам. Поля `refuse` нет ни
 * у одного из восьми возвращаемых типов Pi, поэтому перезаписывающий хук за отказ не примут.
 */
const readRefusal = (value: unknown): string | undefined => {
  const refusal = (value ?? {}) as { refuse?: unknown };

  return typeof refusal.refuse === "string" ? refusal.refuse : undefined;
};

/**
 * Ответить на вызов ядра. Исключение обработчика **не выпускается наружу**: оно уезжает сбоем, потому
 * что до Pi доходить ему нельзя — там оно роняет турн (docs/hooks.md). Ответ уходит всегда, иначе
 * ядро ждало бы своего таймаута на живом воркере.
 */
const answerCall = async (callId: string, call: PluginCall): Promise<void> => {
  const result = await (async (): Promise<PluginCallResult> => {
    try {
      if (call.kind === "tool") {
        return { kind: "value", value: await invokeTool(call.contributionId, call.arguments) };
      }

      if (call.kind === "route") {
        // Ответ маршрута — обычное значение: отказа у него нет вовсе, свой отказ маршрут выражает
        // кодом ответа, а не исходом вызова (docs/web-api.md).
        return { kind: "value", value: await invokeRoute(call.contributionId, call.request) };
      }

      const value = await invokeHookHandler(call.contributionId, call.payload);
      const refusal = readRefusal(value);

      return refusal === undefined
        ? { kind: "value", value }
        : { kind: "refused", reason: refusal };
    } catch (cause) {
      return { kind: "failed", reason: describe(cause) };
    }
  })();

  send({ kind: "call-result", callId, result });
};

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

  if (message.kind === "login-step") {
    void walkLoginStep(message.requestId, message.step);

    return;
  }

  if (message.kind === "call") {
    void answerCall(message.callId, message.call);

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
    // Это абсолютный file: URL внешнего плагина, а не импорт соседней области демона.
    // eslint-disable-next-line no-restricted-syntax
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
