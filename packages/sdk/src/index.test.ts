import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clearEventHandlers } from "./events.ts";
import { removePluginHost } from "./host.ts";
import { contribute, defineEvent, events, identity, log, providers, sessions, z } from "./index.ts";
import type { CustomProviderDefinition, ProviderSummary } from "./index.ts";
import { installTestHost } from "./testing.ts";

const anthropic: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [{ type: "api_key", label: "Anthropic API key" }],
  auth: { kind: "configured", type: "api_key", source: "stored credential" },
  dynamic: false,
  custom: false,
  modelCount: 12,
};

afterEach(() => {
  clearEventHandlers();
  removePluginHost();
});

describe("the zod re-exported by the sdk", () => {
  it("describes a schema as data, which is the only form that reaches the core", () => {
    const description = z.toJSONSchema(z.object({ id: z.string() }));

    // Схема сама по себе не клонируется — в ней функции. Уезжает описание, и оно обязано пережить
    // структурное клонирование, иначе объявление вклада не дойдёт до демона (docs/event-bus.md).
    assert.deepEqual(structuredClone(description), description);
  });
});

describe("the sdk without a host", () => {
  it("explains itself instead of failing on undefined", async () => {
    const taskCreated = defineEvent("task.created", z.object({ id: z.string() }));

    await assert.rejects(() => log.info("hello"), /sdk is not initialised/);
    await assert.rejects(() => contribute.custom({ id: "board" }), /sdk is not initialised/);
    await assert.rejects(() => contribute.event(taskCreated), /sdk is not initialised/);
    await assert.rejects(
      () => contribute.agent({ id: "agent", instructions: "делай", tools: { include: ["*"] } }),
      /sdk is not initialised/,
    );
    await assert.rejects(() => taskCreated.publish({ id: "42" }), /sdk is not initialised/);
    await assert.rejects(
      () => events.subscribe("tracker.task.created", () => {}),
      /sdk is not initialised/,
    );
    await assert.rejects(() => providers.list(), /sdk is not initialised/);
    await assert.rejects(() => sessions.list(), /sdk is not initialised/);
    assert.throws(() => identity(), /sdk is not initialised/);
  });
});

describe("the session surface", () => {
  it("can ask for the archived sessions of one project", async () => {
    const host = installTestHost({ id: "tracker" });

    host.answerSessions(() => ({ kind: "session-list", sessions: [] }));

    assert.deepEqual(await sessions.list("p1", true), []);
    assert.deepEqual(host.sessionRequests, [
      { kind: "session-list", projectId: "p1", archived: true },
    ]);
  });

  it("asks the platform for the agents and hands them over as they came", async () => {
    const host = installTestHost({ id: "tracker" });
    const agent = {
      id: "base-agent.agent",
      pluginKey: "builtin:base-agent",
      source: "builtin",
      skills: [],
    };

    host.answerSessions(() => ({ kind: "agent-list", agents: [agent] }));

    assert.deepEqual(await sessions.agents(), [agent]);
    assert.deepEqual(host.sessionRequests, [{ kind: "agent-list" }]);
  });

  it("creates a session and starts a turn in it", async () => {
    const host = installTestHost({ id: "tracker" });
    const created = {
      id: "0199",
      projectId: "p1",
      folder: "/tmp/demo",
      agentId: "base-agent.agent",
      model: "scripted/one",
      thinkingLevel: "off" as const,
      phase: "idle" as const,
      archived: false,
      createdAt: "2026-07-29T09:00:00.000Z",
    };

    host.answerSessions((request) =>
      request.kind === "session-create"
        ? { kind: "session-create", session: created }
        : { kind: "session-prompt", accepted: { sessionId: "0199", turnId: "t1", phase: "turn" } },
    );

    assert.deepEqual(
      await sessions.create({ projectId: "p1", agentId: "base-agent.agent" }),
      created,
    );
    assert.deepEqual(await sessions.prompt({ sessionId: "0199", text: "сделай" }), {
      sessionId: "0199",
      turnId: "t1",
      phase: "turn",
    });
  });

  it("turns a refusal of the platform into an error with its reason", async () => {
    const host = installTestHost({ id: "tracker" });

    host.answerSessions(() => ({ kind: "failed", reason: "the project is archived" }));

    await assert.rejects(() => sessions.list(), /the project is archived/);
  });

  it("does not pretend the platform answered when nobody told it what to answer", async () => {
    installTestHost({ id: "tracker" });

    // Тест, забывший поставить ответ, обязан упасть с внятной причиной, а не получить пустой список.
    await assert.rejects(() => sessions.list(), /answerSessions/);
  });
});

describe("the provider surface", () => {
  it("asks the platform for the list and hands it over as it came", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerProviders(() => ({ kind: "list", providers: [anthropic] }));

    assert.deepEqual(await providers.list(), [anthropic]);
    assert.deepEqual(host.providerRequests, [{ kind: "list" }]);
  });

  it("tells a provider with no models apart from a provider nobody registered", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerProviders((request) =>
      request.kind === "models" && request.providerId === "anthropic"
        ? { kind: "models", models: [] }
        : { kind: "models" },
    );

    assert.deepEqual(await providers.models("anthropic"), []);
    assert.equal(await providers.models("выдуманный"), undefined);
  });

  it("asks for the status of one provider and for a refresh of every dynamic one", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerProviders((request) =>
      request.kind === "status"
        ? { kind: "status", status: { kind: "unconfigured" } }
        : { kind: "refresh", report: { refreshed: [], aborted: false } },
    );

    assert.deepEqual(await providers.status("anthropic"), { kind: "unconfigured" });
    assert.deepEqual(await providers.refresh(), { refreshed: [], aborted: false });
    assert.deepEqual(host.providerRequests, [
      { kind: "status", providerId: "anthropic" },
      { kind: "refresh" },
    ]);
  });

  it("throws the reason the platform gave instead of answering with nothing", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerProviders(() => ({ kind: "failed", reason: "the catalogue is not there" }));

    await assert.rejects(() => providers.list(), /the catalogue is not there/);
  });

  it("refuses to read an answer of the wrong kind rather than pretend it is empty", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerProviders(() => ({ kind: "models", models: [] }));

    await assert.rejects(() => providers.list(), /answered models to a list request/);
  });

  it("walks the whole login dialogue and gives back what it ended with", async () => {
    const host = installTestHost({ id: "tracker" });
    const heard: string[] = [];

    host.answerLogin({
      steps: [
        { kind: "notice", notice: { kind: "progress", message: "ждём провайдера" } },
        {
          kind: "prompt",
          prompt: { stepId: "a1b2-1", kind: "secret", message: "ключ?" },
        },
      ],
    });

    const conclusion = await providers.login({
      providerId: "anthropic",
      method: "api_key",
      dialogue: {
        tell: (notice) => heard.push(notice.kind),
        ask: (prompt) => `ответ на ${prompt.stepId}`,
      },
    });

    assert.deepEqual(conclusion, { kind: "succeeded" });
    assert.deepEqual(heard, ["progress"]);
    assert.deepEqual(host.loginAnswers, ["ответ на a1b2-1"]);
    assert.equal(host.logins[0]?.providerId, "anthropic");
  });

  it("gives back a cancelled login as a conclusion, not as a failure", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerLogin({ conclusion: { kind: "cancelled" } });

    assert.deepEqual(
      await providers.login({
        providerId: "anthropic",
        method: "oauth",
        // Плагину, которому диалог неинтересен, `tell` не нужен: он необязателен.
        dialogue: { ask: () => "" },
      }),
      { kind: "cancelled" },
    );
  });

  it("asks the platform to log a provider out", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerProviders(() => ({ kind: "logout" }));

    await providers.logout("anthropic");

    assert.deepEqual(host.providerRequests, [{ kind: "logout", providerId: "anthropic" }]);
  });

  it("registers a provider made of data only, and takes it away by name", async () => {
    const host = installTestHost({ id: "vendor" });
    host.answerProviders((request) =>
      request.kind === "register" ? { kind: "register" } : { kind: "unregister" },
    );

    const definition: CustomProviderDefinition = {
      id: "vendor-local",
      name: "Vendor Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      apiKey: { label: "Vendor key" },
      models: [
        { id: "vendor-large", name: "Vendor Large", contextWindow: 32_000, maxTokens: 4_096 },
      ],
    };

    await providers.register(definition);
    await providers.unregister("vendor-local");

    assert.deepEqual(host.providerRequests, [
      { kind: "register", definition },
      { kind: "unregister", providerId: "vendor-local" },
    ]);

    // Определение переживает границу воркера целиком: функций в нём нет и быть не может.
    assert.deepEqual(structuredClone(definition), definition);
  });

  it("throws when the identifier of a registered provider is taken", async () => {
    const host = installTestHost({ id: "vendor" });
    host.answerProviders(() => ({
      kind: "failed",
      reason: "the provider anthropic is already registered",
    }));

    await assert.rejects(
      () =>
        providers.register({
          id: "anthropic",
          name: "Не Anthropic",
          baseUrl: "http://127.0.0.1:11434/v1",
          api: "openai-completions",
          apiKey: { label: "Vendor key" },
          models: [],
        }),
      /the provider anthropic is already registered/,
    );
  });

  it("has no way to read or write the value of a credential", async () => {
    const host = installTestHost({ id: "tracker" });
    host.answerProviders(() => ({ kind: "list", providers: [anthropic] }));

    // Ни метода:
    // @ts-expect-error — читать значение креда SDK не умеет и не будет (docs/models-and-providers.md).
    assert.equal(providers.credential, undefined);
    // @ts-expect-error — и записывать тоже.
    assert.equal(providers.setCredential, undefined);
    assert.deepEqual(
      Object.keys(providers).sort(),
      ["list", "login", "logout", "models", "refresh", "register", "status", "unregister"],
      "поверхность провайдеров изменилась — проверь, не появилось ли в ней значение креда",
    );

    // Ни поля: провайдер рассказывает о себе статусом, а не кредом.
    const [summary] = await providers.list();

    assert.deepEqual(Object.keys(summary ?? {}).filter(mentionsSecret), []);
    assert.deepEqual(Object.keys(summary?.auth ?? {}).filter(mentionsSecret), []);
  });
});

/** Имена, за которыми могло бы приехать значение креда. Ни одного из них в поверхности нет. */
function mentionsSecret(key: string): boolean {
  return ["credential", "key", "apiKey", "token", "access", "refresh", "secret"].includes(key);
}

describe("the testing seam", () => {
  it("records log calls with their level and fields", async () => {
    const host = installTestHost({ id: "hello" });

    await log.warn("something is off", { attempt: 2 });
    await log.debug("details");

    assert.deepEqual(host.logs, [
      { level: "warn", message: "something is off", fields: { attempt: 2 } },
      { level: "debug", message: "details" },
    ]);
  });

  it("records contributions as the plugin declared them", async () => {
    const host = installTestHost();

    await contribute.custom({ id: "board", title: "Board", payload: { columns: 3 } });

    assert.deepEqual(host.contributions, [
      { kind: "custom", id: "board", title: "Board", payload: { columns: 3 } },
    ]);
  });

  it("records an agent the way the plugin declared it", async () => {
    const host = installTestHost();

    await contribute.agent({
      id: "agent",
      title: "Base agent",
      instructions: "делай, что просят",
      tools: { include: ["*"] },
    });

    // Умолчаний SDK не подставляет: ни пустого exclude, ни пустых скилов. Их ставит ядро, и вторая
    // точка, где решается «что значит не сказано», означала бы два разных ответа на один вопрос.
    assert.deepEqual(host.contributions, [
      {
        kind: "agent",
        id: "agent",
        title: "Base agent",
        instructions: "делай, что просят",
        tools: { include: ["*"] },
      },
    ]);
  });

  it("tells the plugin who it is", () => {
    installTestHost({ id: "hello", source: "builtin" });

    assert.deepEqual(identity(), { id: "hello", source: "builtin" });
  });

  it("is removed by restore, so the next test starts without a host", async () => {
    const host = installTestHost();
    host.restore();

    await assert.rejects(() => log.info("hello"), /sdk is not initialised/);
  });

  it("serves a plugin imported after the seam is installed", async () => {
    const host = installTestHost({ id: "hello" });
    const plugin = await import("./testing-fixture.ts");

    await plugin.activate();

    assert.deepEqual(host.logs, [{ level: "info", message: "hello is up" }]);
    assert.deepEqual(host.contributions, [{ kind: "custom", id: "board", title: "Board" }]);
  });
});

describe("a declared event", () => {
  const taskCreated = defineEvent(
    "task.created",
    z.object({ id: z.string(), title: z.string().optional() }),
  );

  it("is declared as a contribution with its schema as data", async () => {
    const host = installTestHost({ id: "tracker" });

    await contribute.event(taskCreated);

    assert.deepEqual(host.contributions, [
      {
        kind: "event",
        id: "task.created",
        payloadSchema: z.toJSONSchema(taskCreated.schema),
      },
    ]);
  });

  it("keeps the schema at hand, so a subscriber importing the descriptor can check the payload", () => {
    installTestHost({ id: "tracker" });

    assert.equal(taskCreated.schema.safeParse({ id: "42" }).success, true);
    assert.equal(taskCreated.schema.safeParse({ id: 42 }).success, false);
  });

  it("publishes a payload that matches the schema", async () => {
    const host = installTestHost({ id: "tracker" });

    await taskCreated.publish({ id: "42" });

    assert.deepEqual(host.published, [{ declaredId: "task.created", payload: { id: "42" } }]);
  });

  it("refuses a payload that does not match, and sends nothing", async () => {
    const host = installTestHost({ id: "tracker" });

    await assert.rejects(
      // @ts-expect-error — автор ошибся в типе; проверка обязана поймать это и в рантайме.
      () => taskCreated.publish({ id: 42 }),
      /the payload of the event task\.created does not match its schema/,
    );

    assert.deepEqual(host.published, []);
  });

  it("names the offending field in the schema error message", async () => {
    installTestHost({ id: "tracker" });

    // Сообщение собирается через стабильный z.flattenError, а не недокументированный
    // z.prettifyError: поле и причина обязаны быть видны автору плагина.
    await assert.rejects(
      // @ts-expect-error — намеренно неверный тип поля.
      () => taskCreated.publish({ id: 42 }),
      (error: Error) =>
        error.message.includes("task.created") &&
        error.message.includes("id:") &&
        /expected string/.test(error.message),
    );
  });
});

describe("a subscription", () => {
  it("tells the core the full name once and delivers to every handler", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    await events.subscribe("tracker.task.created", (payload) => {
      seen.push(payload);
    });
    await events.subscribe("tracker.task.created", (payload, origin) => {
      seen.push(origin?.id ?? payload);
    });

    await host.deliver(
      "tracker.task.created",
      { id: "42" },
      { key: "data:tracker", id: "tracker", source: "data" },
    );

    assert.deepEqual(host.subscriptions, ["tracker.task.created"]);
    assert.deepEqual(seen, [{ id: "42" }, "tracker"]);
  });

  it("stops delivering after the unsubscribe it returned", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    const unsubscribe = await events.subscribe("tracker.task.created", (payload) => {
      seen.push(payload);
    });

    await unsubscribe();
    await host.deliver("tracker.task.created", { id: "42" });

    assert.deepEqual(seen, []);
    assert.deepEqual(host.subscriptions, []);
  });

  it("keeps the name subscribed while another handler still wants it", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    const unsubscribe = await events.subscribe("tracker.task.created", () => {
      seen.push("first");
    });
    await events.subscribe("tracker.task.created", () => {
      seen.push("second");
    });

    await unsubscribe();
    await host.deliver("tracker.task.created", { id: "42" });

    assert.deepEqual(host.subscriptions, ["tracker.task.created"]);
    assert.deepEqual(seen, ["second"]);
  });

  it("reports a handler that threw instead of losing it, and delivers to the rest", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    await events.subscribe("tracker.task.created", () => {
      throw new Error("the handler is broken");
    });
    await events.subscribe("tracker.task.created", () => {
      seen.push("second");
    });

    await host.deliver("tracker.task.created", { id: "42" });

    assert.deepEqual(seen, ["second"]);
    assert.equal(host.logs.at(-1)?.level, "error");
    assert.match(String(host.logs.at(-1)?.fields?.["reason"]), /the handler is broken/);
  });
});
