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

import {
  createAgentSessionStore,
  type AgentSessionStore,
  type CompactionTuning,
} from "./agent-session.ts";
import type { LoginKeyTarget } from "@sovereign/protocol";

import type { CredentialVault } from "./credentials.ts";
import type { Environment } from "./environment.ts";

/**
 * Хранилище кредов в памяти. Тот же контракт, что у файла демона, без файла: набор именованных
 * ключей на провайдера с выбранным. Названный в `initial` кред становится единственным ключом
 * `key-1` — ровно как файл прежней формы у демона.
 */
export function inMemoryVault(initial: Record<string, unknown> = {}): CredentialVault {
  type Key = { id: string; label: string; credential: unknown };
  type KeySet = { keys: Key[]; selected: string };

  const credentials = new Map<string, KeySet>(
    Object.entries(initial).map(([providerId, credential]) => [
      providerId,
      { keys: [{ id: "key-1", label: "", credential }], selected: "key-1" },
    ]),
  );
  const targets = new Map<string, { target: LoginKeyTarget; written?: string }>();
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

  const keyOf = (providerId: string, keyId: string): Key | undefined =>
    credentials.get(providerId)?.keys.find((key) => key.id === keyId);

  const writeStep = async (
    providerId: string,
    target: LoginKeyTarget,
    write: (current: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    const current = target.kind === "new" ? undefined : keyOf(providerId, target.keyId)?.credential;
    const written = await write(current);

    if (written === undefined) {
      return current;
    }

    const set = credentials.get(providerId);
    let keyId: string;

    if (target.kind === "new") {
      keyId = `key-${String((set?.keys.length ?? 0) + 1)}`;
      credentials.set(providerId, {
        keys: [...(set?.keys ?? []), { id: keyId, label: target.label, credential: written }],
        selected: set === undefined ? keyId : set.selected,
      });
    } else {
      keyId = target.keyId;
      credentials.set(providerId, {
        keys: (set?.keys ?? []).map((key) =>
          key.id === keyId ? { ...key, credential: written } : key,
        ),
        selected: set?.selected ?? keyId,
      });
    }

    const active = targets.get(providerId);

    if (active !== undefined) {
      active.written = keyId;
    }

    return written;
  };

  return {
    read: (providerId) => {
      const set = credentials.get(providerId);

      return Promise.resolve(
        set === undefined ? undefined : keyOf(providerId, set.selected)?.credential,
      );
    },
    list: () => [...credentials.keys()],
    keys: (providerId) =>
      (credentials.get(providerId)?.keys ?? []).map(({ id, label }) => ({ id, label })),
    selected: (providerId) => credentials.get(providerId)?.selected,
    readKey: (providerId, keyId) => Promise.resolve(keyOf(providerId, keyId)?.credential),
    modify: (providerId, write) =>
      enqueue(providerId, () => {
        const selected = credentials.get(providerId)?.selected;
        const target: LoginKeyTarget =
          targets.get(providerId)?.target ??
          (selected === undefined
            ? { kind: "new", label: "" }
            : { kind: "existing", keyId: selected });

        return writeStep(providerId, target, write);
      }),
    modifyKey: (providerId, keyId, write) =>
      enqueue(providerId, async () =>
        keyOf(providerId, keyId) === undefined
          ? undefined
          : writeStep(providerId, { kind: "existing", keyId }, write),
      ),
    withKeyTarget: async (providerId, target, run) => {
      const active = { target };

      targets.set(providerId, active);

      try {
        return { result: await run(), keyId: (active as { written?: string }).written };
      } finally {
        targets.delete(providerId);
      }
    },
    select: (providerId, keyId) =>
      enqueue(providerId, async () => {
        const set = credentials.get(providerId);

        if (set === undefined || keyOf(providerId, keyId) === undefined) {
          return false;
        }

        credentials.set(providerId, { ...set, selected: keyId });

        return true;
      }),
    rename: (providerId, keyId, label) =>
      enqueue(providerId, async () => {
        const set = credentials.get(providerId);

        if (set === undefined || keyOf(providerId, keyId) === undefined) {
          return false;
        }

        credentials.set(providerId, {
          ...set,
          keys: set.keys.map((key) => (key.id === keyId ? { ...key, label } : key)),
        });

        return true;
      }),
    removeKey: (providerId, keyId) =>
      enqueue(providerId, async () => {
        const set = credentials.get(providerId);

        if (set === undefined || keyOf(providerId, keyId) === undefined) {
          return false;
        }

        const keys = set.keys.filter((key) => key.id !== keyId);
        const first = keys[0];

        if (first === undefined) {
          credentials.delete(providerId);
        } else {
          credentials.set(providerId, {
            keys,
            selected: set.selected === keyId ? first.id : set.selected,
          });
        }

        return true;
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
export type ScriptedTurn = {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  /**
   * Сколько это обращение «стоило». Не названо — ноль: сложение нулей неотличимо от потерянной траты,
   * поэтому тесту учёта нужен способ назвать разные величины на разные обращения.
   */
  tokens?: number;
};

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
  /** Что модель принимает на вход. По умолчанию только текст: картинки умеет не всякая. */
  input?: ("text" | "image")[];
};

export type ScriptedModelProvider = {
  provider: Provider;
  model: Model<Api>;
  /**
   * Второй, заведомо текстовый двойник того же провайдера. Нужен, чтобы отличить «модель не умеет
   * картинки» от «модели вовсе нет»: без него переключение на текстовую модель проверялось бы
   * несуществующим именем и проходило бы по неверной причине.
   */
  textOnlyModel: Model<Api>;
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
    input: options.input ?? ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };
  const textOnlyModel: Model<Api> = { ...model, id: `${modelId}-text-only`, input: ["text"] };

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
    models: [model, textOnlyModel],
    api: { stream, streamSimple: stream },
    auth: {
      apiKey: {
        name: "Scripted model key",
        // Ключ у двойника всегда есть: вход — тема другого двойника, а здесь он был бы шумом.
        resolve: () => Promise.resolve({ auth: { apiKey: "scripted" }, source: "scripted" }),
      },
    },
  });

  return { provider, model, textOnlyModel, requests };
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

  if (turn.tokens !== undefined) {
    message.usage = { ...message.usage, output: turn.tokens, totalTokens: turn.tokens };
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
export function scriptedSessionStore(options: {
  directory: string;
  sovereignDataDirectory: string;
  /** Корень архива. Не назван — берётся сосед `<directory>-archived`, чтобы тест не заводил второй. */
  archivedDirectory?: string;
  turns?: ScriptedTurn[];
  /** Параметры компакции. Не названы — те же, что зашиты в Pi (docs/data-directory.md). */
  compactionSettings?: () => CompactionTuning;
  /** Что двойник модели принимает на вход. По умолчанию только текст. */
  input?: ("text" | "image")[];
}): {
  store: AgentSessionStore;
  model: string;
  /** Окно контекста двойника: по нему тест считает, где проходит доля автопорога. */
  contextWindow: number;
  removeModel: () => void;
  restoreModel: () => void;
  /** Контексты, отправленные двойнику модели; интеграционные тесты проверяют реальный prompt/tool flow. */
  requests: Context[];
} {
  const scripted = scriptedModelProvider({
    turns: options.turns ?? [],
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  const models = createModels();

  models.setProvider(scripted.provider);

  return {
    store: createAgentSessionStore({
      models,
      directory: options.directory,
      sovereignDataDirectory: options.sovereignDataDirectory,
      archivedDirectory: options.archivedDirectory ?? `${options.directory}-archived`,
      compactionSettings:
        options.compactionSettings ?? (() => ({ reserveTokens: 16384, keepRecentTokens: 20000 })),
    }),
    model: `${scripted.model.provider}/${scripted.model.id}`,
    requests: scripted.requests,
    contextWindow: scripted.model.contextWindow,
    removeModel: () => models.deleteProvider(scripted.provider.id),
    restoreModel: () => models.setProvider(scripted.provider),
  };
}
