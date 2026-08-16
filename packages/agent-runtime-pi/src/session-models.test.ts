import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  Models,
  ModelsSimpleStreamOptions,
  ProviderHeaders,
} from "@earendil-works/pi-ai";
import { createKeyPool, type Attempt, type KeyVerdict } from "@sovereign/model-routing";

import { createSessionModels, type SessionRouter } from "./session-models.ts";

const model = {
  id: "claude-opus-4-5",
  name: "Claude Opus 4.5",
  provider: "anthropic",
  api: "anthropic-messages",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: true,
  input: ["text"],
  cost: { input: 3, output: 15 },
} as unknown as Model<Api>;

const answer = (): AssistantMessage =>
  ({
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  }) as AssistantMessage;

/** Что провайдер делает на очередной запрос. */
type Script =
  | { kind: "answers"; text?: string }
  /** Отказ до первого содержательного события: ровно тот случай, ради которого есть переход. */
  | { kind: "refuses"; message: string }
  /** Отказ после того, как текст пошёл: переигрывать его нельзя. */
  | { kind: "breaks"; after: string; message: string };

type Call = { model: Model<Api>; apiKey?: string; headers?: ProviderHeaders };

function collection(script: Script[]) {
  const calls: Call[] = [];
  const run = (options?: ModelsSimpleStreamOptions) => {
    const step = script[calls.length - 1] ?? { kind: "answers" as const };
    const stream = createAssistantMessageEventStream();
    const partial = answer();

    void (async () => {
      stream.push({ type: "start", partial });
      await Promise.resolve();

      if (step.kind === "refuses") {
        stream.push({
          type: "error",
          reason: "error",
          error: { ...partial, stopReason: "error", errorMessage: step.message },
        });
        stream.end();

        return;
      }

      const text = step.kind === "breaks" ? step.after : (step.text ?? "готово");

      stream.push({ type: "text_start", contentIndex: 0, partial });
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });

      if (step.kind === "breaks") {
        stream.push({
          type: "error",
          reason: "error",
          error: { ...partial, stopReason: "error", errorMessage: step.message },
        });
        stream.end();

        return;
      }

      stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
      stream.push({ type: "done", reason: "stop", message: { ...partial, stopReason: "stop" } });
      stream.end();
    })();

    void options;

    return stream;
  };

  const models = {
    getModel: (providerId: string, modelId: string) =>
      providerId === model.provider && modelId === model.id ? model : undefined,
    streamSimple: (
      requested: Model<Api>,
      _context: Context,
      options?: ModelsSimpleStreamOptions,
    ) => {
      const headers = options?.transformHeaders?.({}) as ProviderHeaders | undefined;

      calls.push({
        model: requested,
        ...(options?.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(headers === undefined ? {} : { headers }),
      });

      return run(options);
    },
  } as unknown as Models;

  return { models, calls };
}

function router(keys: string[], overrides: Partial<SessionRouter> = {}): SessionRouter {
  const pool = createKeyPool();
  const reported: { attempt: Attempt; verdict: KeyVerdict | "success" }[] = [];

  return {
    candidatesFor: (requested) => [{ providerId: requested.provider, modelId: requested.id }],
    keysOf: (providerId) => pool.usable(providerId, keys),
    lease: (providerId) => pool.lease(providerId, keys),
    authFor: (attempt) =>
      Promise.resolve(
        attempt.keyId === undefined
          ? undefined
          : { apiKey: `sk-${attempt.keyId}`, headers: { "x-key": attempt.keyId } },
      ),
    report: (attempt, verdict) => {
      reported.push({ attempt, verdict });
      if (attempt.keyId !== undefined && verdict !== "success") {
        pool.report(attempt.candidate.providerId, attempt.keyId, verdict);
      }
    },
    ...overrides,
  };
}

const drain = async (
  stream: ReturnType<Models["streamSimple"]>,
): Promise<AssistantMessageEvent[]> => {
  const events: AssistantMessageEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
};

const context: Context = { messages: [] };

describe("the models collection of a session", () => {
  it("puts the key of the session into every request", async () => {
    const { models, calls } = collection([{ kind: "answers" }]);
    const sessionModels = createSessionModels({ models, router: router(["key-1", "key-2"]) });

    await drain(sessionModels.streamSimple(model, context));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.apiKey, "sk-key-1");
    // Заголовки ключа ставятся последними: авторизация выбранного креда не должна просочиться в
    // запрос, который идёт другим ключом.
    assert.deepEqual(calls[0]?.headers, { "x-key": "key-1" });
  });

  it("keeps the same key for the whole session", async () => {
    const { models, calls } = collection([{ kind: "answers" }, { kind: "answers" }]);
    const sessionModels = createSessionModels({ models, router: router(["key-1", "key-2"]) });

    await drain(sessionModels.streamSimple(model, context));
    await drain(sessionModels.streamSimple(model, context));

    assert.deepEqual(
      calls.map((call) => call.apiKey),
      ["sk-key-1", "sk-key-1"],
    );
  });

  it("gives two sessions two different keys", async () => {
    const { models, calls } = collection([{ kind: "answers" }, { kind: "answers" }]);
    const shared = router(["key-1", "key-2"]);

    await drain(createSessionModels({ models, router: shared }).streamSimple(model, context));
    await drain(createSessionModels({ models, router: shared }).streamSimple(model, context));

    // Лимит одного ключа собрался бы на одном ключе, начинай все сессии с первого.
    assert.deepEqual(
      calls.map((call) => call.apiKey),
      ["sk-key-1", "sk-key-2"],
    );
  });

  it("moves on to the next key when the first one is rate limited", async () => {
    const { models, calls } = collection([
      { kind: "refuses", message: '429 {"type":"rate_limit_error"}' },
      { kind: "answers", text: "ответ" },
    ]);
    const sessionModels = createSessionModels({ models, router: router(["key-1", "key-2"]) });

    const events = await drain(sessionModels.streamSimple(model, context));

    assert.deepEqual(
      calls.map((call) => call.apiKey),
      ["sk-key-1", "sk-key-2"],
    );
    // Лента не видит отказа вовсе: он случился до первого содержательного события.
    assert.deepEqual(
      events.map((event) => event.type),
      ["start", "text_start", "text_delta", "text_end", "done"],
    );
  });

  it("stays on the key it moved to", async () => {
    const { models, calls } = collection([
      { kind: "refuses", message: "429 slow down" },
      { kind: "answers" },
      { kind: "answers" },
    ]);
    const sessionModels = createSessionModels({ models, router: router(["key-1", "key-2"]) });

    await drain(sessionModels.streamSimple(model, context));
    await drain(sessionModels.streamSimple(model, context));

    assert.deepEqual(
      calls.map((call) => call.apiKey),
      ["sk-key-1", "sk-key-2", "sk-key-2"],
    );
  });

  it("does not replay a turn that already said something", async () => {
    const { models, calls } = collection([
      { kind: "breaks", after: "начало ", message: "429 slow down" },
      { kind: "answers" },
    ]);
    const sessionModels = createSessionModels({ models, router: router(["key-1", "key-2"]) });

    const events = await drain(sessionModels.streamSimple(model, context));

    // Повтор после начала ответа удвоил бы уже показанный текст.
    assert.equal(calls.length, 1);
    assert.equal(events.at(-1)?.type, "error");
  });

  it("gives up with the last refusal when every key is spent", async () => {
    const { models, calls } = collection([
      { kind: "refuses", message: "401 invalid x-api-key" },
      { kind: "refuses", message: "401 invalid x-api-key too" },
    ]);
    const sessionModels = createSessionModels({ models, router: router(["key-1", "key-2"]) });

    const events = await drain(sessionModels.streamSimple(model, context));
    const last = events.at(-1);

    assert.equal(calls.length, 2);
    assert.ok(last?.type === "error");
    assert.equal(last.error.errorMessage, "401 invalid x-api-key too");
  });

  it("does not walk the keys on a failure it cannot pin on anybody", async () => {
    const { models, calls } = collection([
      { kind: "refuses", message: "the operation was aborted" },
      { kind: "answers" },
    ]);
    const sessionModels = createSessionModels({ models, router: router(["key-1", "key-2"]) });

    const events = await drain(sessionModels.streamSimple(model, context));

    // Отмену сделал человек: перебирать по ней ключи значит сжечь набор на своём же действии.
    assert.equal(calls.length, 1);
    assert.equal(events.at(-1)?.type, "error");
  });

  it("takes the key that was refused out of the way of the next session", async () => {
    const { models, calls } = collection([
      { kind: "refuses", message: "401 invalid x-api-key" },
      { kind: "answers" },
      { kind: "answers" },
    ]);
    const shared = router(["key-1", "key-2"]);

    await drain(createSessionModels({ models, router: shared }).streamSimple(model, context));
    await drain(createSessionModels({ models, router: shared }).streamSimple(model, context));

    assert.deepEqual(
      calls.map((call) => call.apiKey),
      ["sk-key-1", "sk-key-2", "sk-key-2"],
    );
  });

  it("says which key it moved to and why", async () => {
    const switches: string[] = [];
    const { models } = collection([
      { kind: "refuses", message: "429 slow down" },
      { kind: "answers" },
    ]);
    const sessionModels = createSessionModels({
      models,
      router: router(["key-1", "key-2"], {
        onSwitch: (from, to, reason) =>
          switches.push(`${from.keyId ?? ""} → ${to.keyId ?? ""}: ${reason}`),
      }),
    });

    await drain(sessionModels.streamSimple(model, context));

    assert.deepEqual(switches, ["key-1 → key-2: 429 slow down"]);
  });

  it("goes the plain way of the runtime when the provider has no stored keys", async () => {
    const { models, calls } = collection([{ kind: "answers" }]);
    const sessionModels = createSessionModels({ models, router: router([]) });

    await drain(sessionModels.streamSimple(model, context));

    // Кред из окружения — такой же законный способ ходить, и подменять в запросе нечего.
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.apiKey, undefined);
  });

  it("treats a credential it cannot resolve as a key to move on from", async () => {
    const { models, calls } = collection([{ kind: "answers" }]);
    const sessionModels = createSessionModels({
      models,
      router: router(["key-1", "key-2"], {
        authFor: (attempt) =>
          attempt.keyId === "key-1"
            ? Promise.reject(new Error("the key key-1 has an unknown type"))
            : Promise.resolve({ apiKey: "sk-key-2" }),
      }),
    });

    const events = await drain(sessionModels.streamSimple(model, context));

    assert.deepEqual(
      calls.map((call) => call.apiKey),
      ["sk-key-2"],
    );
    assert.equal(events.at(-1)?.type, "done");
  });

  it("leaves everything that is not a request to the catalogue", () => {
    const { models } = collection([]);
    const sessionModels = createSessionModels({ models, router: router(["key-1"]) });

    // Каталог остаётся общим: второй экземпляр означал бы вторые креды и второй кэш списков.
    assert.equal(sessionModels.getModel("anthropic", model.id), model);
    assert.equal(sessionModels.getModel("openai", model.id), undefined);
  });
});
