/**
 * Двойники для тестов — и наших, и демона. Лежат в пакете, а не в тестах демона, потому что
 * собраны они из типов Pi: демону они недоступны (docs/architecture.md).
 */

import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
} from "@earendil-works/pi-ai";
import type {
  Api,
  ApiKeyCredential,
  AssistantMessage,
  AssistantMessageEventStream,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Context,
  Model,
  Provider,
  TextContent,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";

import { createAgentSessionStore, type AgentSessionStore } from "./agent-session.ts";
import type { CredentialVault } from "./credentials.ts";
import type { Environment } from "./environment.ts";

/** Хранилище кредов в памяти. Тот же контракт, что у файла демона, без файла. */
export function inMemoryVault(initial: Record<string, unknown> = {}): CredentialVault {
  const credentials = new Map(Object.entries(initial));
  const queues = new Map<string, Promise<unknown>>();

  const enqueue = <Result>(providerId: string, step: () => Promise<Result>): Promise<Result> => {
    const previous = queues.get(providerId) ?? Promise.resolve();
    const next = previous.then(step, step);

    queues.set(
      providerId,
      next.catch(() => undefined),
    );

    return next;
  };

  return {
    read: (providerId) => Promise.resolve(credentials.get(providerId)),
    list: () => [...credentials.keys()],
    modify: (providerId, write) =>
      enqueue(providerId, async () => {
        const written = await write(credentials.get(providerId));

        if (written !== undefined) {
          credentials.set(providerId, written);
        }

        return credentials.get(providerId);
      }),
    remove: (providerId) =>
      enqueue(providerId, async () => {
        credentials.delete(providerId);
      }),
    problem: () => undefined,
  };
}

/** Окружение без окружения: ни одной переменной, ни одного файла. */
export function emptyEnvironment(variables: Record<string, string> = {}): Environment {
  return {
    read: (name) => Promise.resolve(variables[name]),
    fileExists: () => Promise.resolve(false),
  };
}

/**
 * Шаг сценария провайдера-двойника — в терминах рантайма, а не протокола: двойник изображает
 * провайдера Pi, и перевод шагов должен работать на нём по-настоящему.
 */
export type ScriptedStep =
  | { say: AuthEvent }
  | { ask: AuthPrompt }
  /** Отказать входом. Так проверяется отказ провайдера, а не отмена человеком. */
  | { fail: string };

export type ScriptedProviderOptions = {
  id?: string;
  name?: string;
  /** Что провайдер делает в ходе входа. Ответы на вопросы собираются в `answers`. */
  script?: ScriptedStep[];
  /** Ключ, который вход записывает в кред, если сценарий дошёл до конца. */
  key?: string;
};

export type ScriptedProvider = {
  provider: Provider;
  /** Ответы, которые пришли на вопросы сценария, в порядке вопросов. */
  answers: string[];
};

/**
 * Провайдер с заранее написанным ходом входа. Нужен потому, что весь OAuth у настоящих провайдеров
 * требует настоящего аккаунта: без двойника механика шагов осталась бы непроверенной вовсе
 * (docs/agent-runtime-contract.md). Живёт в пакете, а не в тестах демона: собран он из типов Pi,
 * а демону они недоступны (docs/architecture.md).
 */
export function scriptedProvider(options: ScriptedProviderOptions = {}): ScriptedProvider {
  const answers: string[] = [];
  const script = options.script ?? [];

  const login = async (interaction: AuthInteraction): Promise<ApiKeyCredential> => {
    for (const step of script) {
      if ("say" in step) {
        interaction.notify(step.say);
      } else if ("ask" in step) {
        answers.push(await interaction.prompt(step.ask));
      } else {
        throw new Error(step.fail);
      }
    }

    return { type: "api_key", key: options.key ?? "s3cret" };
  };

  const provider = createProvider({
    id: options.id ?? "scripted",
    name: options.name ?? "Scripted",
    models: [],
    // Запросов к модели в этом срезе нет вовсе, и двойник их не изображает: попытка стримить через
    // него — это ошибка теста, и молчать о ней нельзя.
    api: {
      stream: () => {
        throw new Error("двойник провайдера не отвечает на запросы к модели");
      },
    } as never,
    auth: {
      apiKey: {
        name: `${options.name ?? "Scripted"} key`,
        login,
        resolve: async ({ credential }) =>
          credential?.key === undefined
            ? undefined
            : { auth: { apiKey: credential.key }, source: "stored credential" },
      },
    },
  });

  return { provider, answers };
}

/** Вызов инструмента, который двойник модели просит сделать. */
export type ScriptedToolCall = { id: string; name: string; arguments: Record<string, unknown> };

/** Один ответ модели: текст, вызовы инструментов или и то, и другое. */
export type ScriptedTurn = { text?: string; toolCalls?: ScriptedToolCall[] };

export type ScriptedModelProviderOptions = {
  id?: string;
  modelId?: string;
  /**
   * Ответы по порядку обращений. Обращение сверх сценария — ошибка теста, а не пустой ответ:
   * молчаливый лишний поход к модели значил бы, что цикл агента не останавливается.
   */
  turns: ScriptedTurn[];
  /**
   * Что сделать перед тем, как двойник ответит на обращение с этим номером. Единственный способ
   * вмешаться в турн изнутри: цикл агента к этому моменту точно идёт, а на живой системе так себя
   * и ведёт человек, дописывающий указание посреди ответа.
   */
  beforeAnswer?: (index: number) => void;
};

export type ScriptedModelProvider = {
  provider: Provider;
  model: Model<Api>;
  /** Контексты обращений в порядке запросов: по ним видно, что именно уехало модели. */
  requests: Context[];
};

/**
 * Провайдер, отвечающий на запросы к модели заранее написанным сценарием. Без него турн агента
 * нечем проверить: настоящая модель требует ключа, сети и денег, а её ответ недетерминирован.
 *
 * Отдельно от `scriptedProvider`: тот изображает вход и нарочно отказывается стримить, и тесты
 * входа держатся именно на этом отказе.
 */
export function scriptedModelProvider(
  options: ScriptedModelProviderOptions,
): ScriptedModelProvider {
  const providerId = options.id ?? "scripted-model";
  const modelId = options.modelId ?? "scripted-model-1";
  const requests: Context[] = [];

  const model: Model<Api> = {
    id: modelId,
    name: "Scripted model",
    api: "openai-completions",
    provider: providerId,
    baseUrl: "https://scripted.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };

  const stream = (streamed: Model<Api>, context: Context): AssistantMessageEventStream => {
    const events = createAssistantMessageEventStream();

    requests.push(context);
    options.beforeAnswer?.(requests.length - 1);
    playTurn(events, streamed, options.turns[requests.length - 1]);

    return events;
  };

  const provider = createProvider({
    id: providerId,
    name: "Scripted model provider",
    models: [model],
    api: { stream, streamSimple: stream },
    auth: {
      apiKey: {
        name: "Scripted model key",
        // Ключ у двойника всегда есть: вход — тема другого двойника, а здесь он был бы шумом.
        resolve: () => Promise.resolve({ auth: { apiKey: "scripted" }, source: "scripted" }),
      },
    },
  });

  return { provider, model, requests };
}

function playTurn(
  events: AssistantMessageEventStream,
  model: Model<Api>,
  turn: ScriptedTurn | undefined,
): void {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };

  if (turn === undefined) {
    events.push({
      type: "error",
      reason: "error",
      error: { ...message, stopReason: "error", errorMessage: "сценарий двойника кончился" },
    });

    return;
  }

  events.push({ type: "start", partial: { ...message } });

  let contentIndex = 0;

  if (turn.text !== undefined) {
    const block: TextContent = { type: "text", text: "" };

    message.content.push(block);
    events.push({ type: "text_start", contentIndex, partial: { ...message } });

    // Текст едет кусками, а не целиком: дельты — то самое, ради чего двойник и заведён.
    for (const piece of splitIntoDeltas(turn.text)) {
      block.text += piece;
      events.push({ type: "text_delta", contentIndex, delta: piece, partial: { ...message } });
    }

    events.push({ type: "text_end", contentIndex, content: block.text, partial: { ...message } });
    contentIndex += 1;
  }

  for (const call of turn.toolCalls ?? []) {
    const toolCall: ToolCall = {
      type: "toolCall",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    };

    message.content.push(toolCall);
    events.push({ type: "toolcall_start", contentIndex, partial: { ...message } });
    events.push({ type: "toolcall_end", contentIndex, toolCall, partial: { ...message } });
    contentIndex += 1;
  }

  message.stopReason = (turn.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop";
  events.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    message,
  });
}

function splitIntoDeltas(text: string): string[] {
  const size = 8;
  const pieces: string[] = [];

  for (let start = 0; start < text.length; start += size) {
    pieces.push(text.slice(start, start + size));
  }

  return pieces.length === 0 ? [""] : pieces;
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Хранилище сессий на двойнике модели. Живёт здесь, а не в тестах демона, по той же причине, что и
 * остальные двойники: собрано оно из типов Pi, а демону они недоступны (docs/architecture.md).
 */
export function scriptedSessionStore(options: { directory: string; turns?: ScriptedTurn[] }): {
  store: AgentSessionStore;
  model: string;
  removeModel: () => void;
  restoreModel: () => void;
} {
  const scripted = scriptedModelProvider({ turns: options.turns ?? [] });
  const models = createModels();

  models.setProvider(scripted.provider);

  return {
    store: createAgentSessionStore({ models, directory: options.directory }),
    model: `${scripted.model.provider}/${scripted.model.id}`,
    removeModel: () => models.deleteProvider(scripted.provider.id),
    restoreModel: () => models.setProvider(scripted.provider),
  };
}
