/**
 * Тестовый шов (docs/plugins.md): плагин обязан проверяться без поднятого демона. Шов подставляет
 * фальшивый хост и записывает всё, что плагин через него сказал.
 *
 * Порядок обязателен: сначала шов, потом `await import()` плагина. Импорт до установки шва — это
 * плагин, у которого при первом же вызове нет хоста.
 */

import { clearEventHandlers, deliverEvent, type EventOrigin } from "./events.ts";
import { clearHookHandlers, invokeHookHandler } from "./hooks.ts";
import {
  clearRouteHandlers,
  invokeRoute,
  type PluginRouteRequest,
  type PluginRouteKind,
  type PluginRouteResponse,
} from "./routes.ts";
import { clearToolInvocations, invokeTool, type PluginToolInvocation } from "./tools.ts";
import {
  installPluginHost,
  removePluginHost,
  type PluginContribution,
  type PluginIdentity,
  type PluginLogLevel,
} from "./host.ts";
import type {
  LoginConclusion,
  LoginInput,
  LoginStep,
  ProviderRequest,
  ProviderResponse,
} from "./providers.ts";
import type { SessionRequest, SessionResponse } from "./sessions.ts";

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
  /** Что плагин спросил о провайдерах, в порядке вызова. */
  providerRequests: ProviderRequest[];
  /**
   * Чем отвечать на запросы о провайдерах. Пока ответ не поставлен, шов отказывает с объяснением:
   * притворяться платформой без провайдеров он не станет — тест, забывший про ответ, обязан упасть
   * с внятной причиной, а не получить пустой список.
   */
  answerProviders: (
    answer: (request: ProviderRequest) => ProviderResponse | Promise<ProviderResponse>,
  ) => void;
  /** Что плагин спросил о сессиях, в порядке вызова. */
  sessionRequests: SessionRequest[];
  /** Чем отвечать на запросы о сессиях. Без ответа шов отказывает с объяснением, как и у провайдеров. */
  answerSessions: (
    answer: (request: SessionRequest) => SessionResponse | Promise<SessionResponse>,
  ) => void;
  /** Входы, которые плагин начал, в порядке вызова. */
  logins: LoginInput[];
  /** Ответы плагина на вопросы входа, в порядке вопросов. */
  loginAnswers: string[];
  /**
   * Что платформа скажет по ходу входа и чем его кончит. Без этого вход кончается удачей молча:
   * плагину, которому диалог неинтересен, писать сценарий незачем.
   */
  answerLogin: (script: { steps?: LoginStep[]; conclusion?: LoginConclusion }) => void;
  /** Доставить событие подписчику — то, что в живой платформе делает ядро. */
  deliver: (type: string, payload: unknown, origin?: EventOrigin) => Promise<void>;
  /**
   * Позвать хук и инструмент — то, что в живой платформе приходит обратным каналом. Идентификатор
   * объявленный, без неймспейса: в воркере таблица обработчиков ключуется им же (docs/hooks.md).
   */
  callHook: (declaredId: string, payload: unknown) => Promise<unknown>;
  /**
   * Контекст вызова необязателен: тесту инструмента, которому обратный адрес неинтересен, писать его
   * незачем. Умолчание — сессия `test-session` в проекте `test-project`.
   */
  callTool: (
    declaredId: string,
    toolArguments: unknown,
    invocation?: Partial<PluginToolInvocation>,
  ) => Promise<{ content: string; isError: boolean }>;
  /** Позвать маршрут — то же, что делает диспетчер, получив запрос на `/api/p/<id плагина>/…`. */
  callRoute: (declaredId: string, request: PluginRouteRequest) => Promise<PluginRouteResponse>;
  /**
   * Хранилище плагина в памяти: настоящее, а не заглушка с ответами. Плагин, который что-то записал
   * и тут же прочитал, обязан проверяться этим же способом, а тест вправе подложить значение сам.
   */
  stored: Map<string, unknown>;
  /** Чем шов отвечает на запрос своей папки. Файлов он не создаёт: их создаёт платформа. */
  answerStorageDirectory: (path: string) => void;
  /** Снимает шов, подписки и таблицы обработчиков. Без этого следующий тест увидит чужой хост. */
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
  const providerRequests: ProviderRequest[] = [];
  const sessionRequests: SessionRequest[] = [];
  const logins: LoginInput[] = [];
  const loginAnswers: string[] = [];
  const stored = new Map<string, unknown>();

  let storageDirectory = `/tmp/sovereign-plugin-${resolved.source}-${resolved.id}`;
  let loginScript: { steps?: LoginStep[]; conclusion?: LoginConclusion } = {};

  let answerProviderRequest: (
    request: ProviderRequest,
  ) => ProviderResponse | Promise<ProviderResponse> = (request) => ({
    kind: "failed",
    reason:
      `the test host was not told what to answer to a ${request.kind} request about providers; ` +
      "install an answer with answerProviders()",
  });

  let answerSessionRequest: (
    request: SessionRequest,
  ) => SessionResponse | Promise<SessionResponse> = (request) => ({
    kind: "failed",
    reason:
      `the test host was not told what to answer to a ${request.kind} request about sessions; ` +
      "install an answer with answerSessions()",
  });

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
    providers: async (request) => {
      providerRequests.push(request);

      return answerProviderRequest(request);
    },
    sessions: async (request) => {
      sessionRequests.push(request);

      return answerSessionRequest(request);
    },
    storage: async (request) => {
      switch (request.kind) {
        case "storage-get":
          // Значения нет — поля нет: так же отвечает и настоящее хранилище.
          return stored.has(request.key)
            ? { kind: "storage-value", value: stored.get(request.key) }
            : { kind: "storage-value" };
        case "storage-set":
          stored.set(request.key, request.value);

          return { kind: "storage-written" };
        case "storage-delete":
          stored.delete(request.key);

          return { kind: "storage-written" };
        case "storage-keys":
          return { kind: "storage-keys", keys: [...stored.keys()].sort() };
        case "storage-directory":
          return { kind: "storage-directory", path: storageDirectory };
      }
    },
    login: async (input) => {
      logins.push(input);

      // Шаги идут по одному и по порядку: платформа задаёт следующий вопрос, дождавшись ответа на
      // предыдущий, и плагин, который на это рассчитывает, обязан проверяться так же.
      for (const step of loginScript.steps ?? []) {
        if (step.kind === "notice") {
          input.dialogue.tell?.(step.notice);
        } else {
          loginAnswers.push(await input.dialogue.ask(step.prompt));
        }
      }

      return loginScript.conclusion ?? { kind: "succeeded" };
    },
  });

  return {
    identity: resolved,
    logs,
    contributions,
    published,
    subscriptions,
    providerRequests,
    answerProviders: (answer) => {
      answerProviderRequest = answer;
    },
    sessionRequests,
    answerSessions: (answer) => {
      answerSessionRequest = answer;
    },
    logins,
    loginAnswers,
    answerLogin: (script) => {
      loginScript = script;
    },
    deliver: deliverEvent,
    callHook: invokeHookHandler,
    callTool: (declaredId, toolArguments, invocation) =>
      invokeTool(declaredId, toolArguments, {
        sessionId: invocation?.sessionId ?? "test-session",
        projectId: invocation?.projectId ?? "test-project",
        folder: invocation?.folder ?? "/test-project",
      }),
    callRoute: (declaredId, request) =>
      invokeRoute(
        (request.public ? "public-route" : "route") satisfies PluginRouteKind,
        declaredId,
        request,
      ),
    stored,
    answerStorageDirectory: (path) => {
      storageDirectory = path;
    },
    restore: () => {
      clearEventHandlers();
      clearHookHandlers();
      clearToolInvocations();
      clearRouteHandlers();
      removePluginHost();
    },
  };
}
