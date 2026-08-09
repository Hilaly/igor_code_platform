import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clearEventHandlers } from "./events.ts";
import { removePluginHost } from "./host.ts";
import { clearHookHandlers } from "./hooks.ts";
import { clearRouteHandlers } from "./routes.ts";
import { clearToolInvocations } from "./tools.ts";
import {
  contribute,
  defineEvent,
  events,
  foldEntryLabels,
  identity,
  log,
  providers,
  sessions,
  storage,
  toolCallPlaceId,
  z,
} from "./index.ts";
import type {
  AgentSummary,
  CustomProviderDefinition,
  PluginRouteRequest,
  ProviderSummary,
} from "./index.ts";
import { installTestHost } from "./testing.ts";

const anthropic: ProviderSummary = {
  id: "anthropic",
  name: "Anthropic",
  logins: [{ type: "api_key", label: "Anthropic API key" }],
  auth: { kind: "configured", type: "api_key", source: "stored credential" },
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 12,
};

afterEach(() => {
  clearEventHandlers();
  clearHookHandlers();
  clearToolInvocations();
  clearRouteHandlers();
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

describe("tool call place names", () => {
  it("matches the public dynamic place contract without importing the internal protocol", () => {
    assert.equal(toolCallPlaceId("spawn_agent"), "core.session.tool-call.t-737061776e5f6167656e74");
    assert.notEqual(toolCallPlaceId("write_file"), toolCallPlaceId("write-file"));
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
    await assert.rejects(
      () => contribute.hook({ id: "watch", event: "turn_finished", handler: () => {} }),
      /sdk is not initialised/,
    );
    await assert.rejects(
      () =>
        contribute.tool({
          id: "weather",
          description: "говорит погоду",
          parameters: z.object({ city: z.string() }),
          invoke: () => "ясно",
        }),
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
  it("types agent ownership and normalized skill selectors in responses", () => {
    const pluginAgent: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      pluginKey: "builtin:github",
      source: "builtin",
      skills: { include: ["github.*"], exclude: ["*-unsafe"] },
    };
    const standaloneAgent: AgentSummary = {
      id: "review",
      ownership: "standalone",
      source: "native:user-agents",
      scope: "user",
      skills: { include: [], exclude: [] },
    };

    assert.equal(
      pluginAgent.ownership === "plugin" ? pluginAgent.pluginKey : undefined,
      "builtin:github",
    );
    assert.equal(
      standaloneAgent.ownership === "standalone" ? standaloneAgent.scope : undefined,
      "user",
    );

    // @ts-expect-error — plugin-owned summaries always identify their plugin instance.
    const pluginWithoutKey: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      source: "builtin",
      skills: { include: [], exclude: [] },
    };
    // @ts-expect-error — standalone summaries do not fabricate a plugin owner.
    const standaloneWithKey: AgentSummary = {
      id: "review",
      ownership: "standalone",
      pluginKey: "builtin:fake",
      source: "native:user-agents",
      scope: "user",
      skills: { include: [], exclude: [] },
    };
    const skillsWithoutExclude: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      pluginKey: "builtin:github",
      source: "builtin",
      // @ts-expect-error — response selectors are normalized even though declaration exclude is optional.
      skills: { include: ["github.*"] },
    };

    assert.ok(pluginWithoutKey);
    assert.ok(standaloneWithKey);
    assert.ok(skillsWithoutExclude);
  });

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
      ownership: "plugin" as const,
      pluginKey: "builtin:base-agent",
      source: "builtin" as const,
      skills: { include: [], exclude: [] },
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
      agentAvailable: true,
      model: "scripted/one",
      thinkingLevel: "off" as const,
      phase: "idle" as const,
      archived: false,
      createdAt: "2026-07-29T09:00:00.000Z",
    };

    host.answerSessions((request) =>
      request.kind === "session-create"
        ? { kind: "session-create", outcome: { kind: "created", session: created } }
        : { kind: "session-prompt", accepted: { sessionId: "0199", turnId: "t1", phase: "turn" } },
    );

    assert.deepEqual(await sessions.create({ projectId: "p1", agentId: "base-agent.agent" }), {
      kind: "created",
      session: created,
    });
    assert.deepEqual(await sessions.prompt({ sessionId: "0199", text: "сделай" }), {
      sessionId: "0199",
      turnId: "t1",
      phase: "turn",
    });
  });

  it("reads the branch and the context, compacts, navigates and labels", async () => {
    const host = installTestHost({ id: "tracker" });
    const entries = [
      { id: "e-1", time: "2026-07-31T09:00:00.000Z", kind: "label" as const, targetId: "e-0" },
      {
        id: "e-2",
        parentId: "e-1",
        time: "2026-07-31T09:00:01.000Z",
        kind: "label" as const,
        targetId: "e-0",
        label: "важное",
      },
    ];

    host.answerSessions((request) => {
      switch (request.kind) {
        case "session-branch":
          return { kind: "session-branch", branch: { sessionId: "0199", entries, leafId: "e-2" } };
        case "session-context":
          return {
            kind: "session-context",
            usage: { sessionId: "0199", tokens: 90, contextWindow: 1000, threshold: 0.8 },
          };
        case "session-compact":
          return {
            kind: "session-compact",
            accepted: { sessionId: "0199", phase: "compaction" },
          };
        case "session-navigate":
          return {
            kind: "session-navigate",
            navigated: { sessionId: "0199", leafId: "e-1", editorText: "иначе", summarized: true },
          };
        default:
          return {
            kind: "session-label",
            labelled: { sessionId: "0199", entryId: "e-0", label: "важное" },
          };
      }
    });

    assert.deepEqual(await sessions.branch("0199", "e-2"), {
      sessionId: "0199",
      entries,
      leafId: "e-2",
    });
    // Свёртка меток живёт в SDK, чтобы каждый плагин не повторял её и не расходился с соседом.
    assert.deepEqual(foldEntryLabels(entries), new Map([["e-0", "важное"]]));
    assert.equal((await sessions.context("0199")).threshold, 0.8);
    assert.equal((await sessions.compact("0199")).phase, "compaction");
    assert.equal((await sessions.navigate("0199", { entryId: "e-1" })).editorText, "иначе");
    assert.equal((await sessions.label("0199", "e-0", { label: "важное" })).label, "важное");

    assert.deepEqual(host.sessionRequests, [
      { kind: "session-branch", sessionId: "0199", from: "e-2" },
      { kind: "session-context", sessionId: "0199" },
      { kind: "session-compact", sessionId: "0199", request: {} },
      { kind: "session-navigate", sessionId: "0199", request: { entryId: "e-1" } },
      { kind: "session-label", sessionId: "0199", entryId: "e-0", update: { label: "важное" } },
    ]);
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
      id: "safe",
      instructions: "work",
    });
    await contribute.agent({
      id: "full",
      instructions: "work",
      tools: { include: ["*"], exclude: ["bash"] },
      skills: { include: ["review-*"], exclude: ["*-unsafe"] },
    });

    // Умолчаний SDK не подставляет: ни пустого exclude, ни пустых скилов. Их ставит ядро, и вторая
    // точка, где решается «что значит не сказано», означала бы два разных ответа на один вопрос.
    assert.deepEqual(host.contributions, [
      {
        kind: "agent",
        id: "safe",
        instructions: "work",
      },
      {
        kind: "agent",
        id: "full",
        instructions: "work",
        tools: { include: ["*"], exclude: ["bash"] },
        skills: { include: ["review-*"], exclude: ["*-unsafe"] },
      },
    ]);
  });

  it("records a command the way the plugin declared it", async () => {
    const host = installTestHost();

    await contribute.command({
      id: "run",
      title: "Run the board",
      export: "RunCommand",
      placeId: "core.view.header.actions",
    });

    assert.deepEqual(host.contributions, [
      {
        kind: "command",
        id: "run",
        title: "Run the board",
        export: "RunCommand",
        placeId: "core.view.header.actions",
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

describe("a hook subscription", () => {
  it("is declared to the core while the handler stays in the worker", async () => {
    const host = installTestHost({ id: "guard" });

    await contribute.hook({
      id: "watch-turns",
      title: "Watch turns",
      event: "turn_finished",
      criticality: "advisory",
      handler: () => {},
    });

    // Обработчик через границу не уезжает: в объявлении его нет вовсе, и объявление обязано
    // переживать структурное клонирование, как всякий вклад (docs/plugins.md).
    assert.deepEqual(host.contributions, [
      {
        kind: "hook",
        id: "watch-turns",
        title: "Watch turns",
        event: "turn_finished",
        criticality: "advisory",
      },
    ]);
    assert.deepEqual(structuredClone(host.contributions), host.contributions);
  });

  it("leaves the unsaid unsaid: no criticality of its own", async () => {
    const host = installTestHost({ id: "guard" });

    await contribute.hook({ id: "watch-turns", event: "turn_finished", handler: () => {} });

    // Умолчание критичности ставит ядро. Второе место, где решается «что значит не сказано»,
    // означало бы два разных ответа на один вопрос — как и у объявления агента.
    assert.deepEqual(host.contributions, [
      { kind: "hook", id: "watch-turns", event: "turn_finished" },
    ]);
  });

  it("answers a call by its declared id and gives the core what the handler returned", async () => {
    const host = installTestHost({ id: "guard" });
    const seen: unknown[] = [];

    await contribute.hook({
      id: "refuse-start",
      event: "before_session_start",
      criticality: "critical",
      handler: (payload) => {
        seen.push(payload);

        return { refuse: "проект закрыт" };
      },
    });

    const answer = await host.callHook("refuse-start", {
      projectId: "p1",
      folder: "/tmp/p1",
      agentId: "base",
    });

    assert.deepEqual(seen, [{ projectId: "p1", folder: "/tmp/p1", agentId: "base" }]);
    assert.deepEqual(answer, { refuse: "проект закрыт" });
  });

  it("returns nothing when the handler has nothing to add", async () => {
    const host = installTestHost({ id: "guard" });

    await contribute.hook({ id: "let-it-be", event: "before_session_start", handler: () => {} });

    // Разрешение — это отсутствие отказа, а не чей-то голос «за» (docs/hooks.md).
    assert.equal(
      await host.callHook("let-it-be", { projectId: "p1", folder: "/tmp/p1", agentId: "base" }),
      undefined,
    );
  });

  it("names the subscription the core asked about but the plugin never declared", async () => {
    const host = installTestHost({ id: "guard" });

    await assert.rejects(
      () => host.callHook("never-declared", {}),
      /no handler for the hook subscription never-declared/,
    );
  });

  it("subscribes to an event of the runtime under the name of the runtime", async () => {
    const host = installTestHost({ id: "guard" });
    const seen: unknown[] = [];

    await contribute.hook({
      id: "watch-tools",
      event: "tool_call",
      handler: (payload) => {
        seen.push(payload.toolName);
      },
    });

    await host.callHook("watch-tools", { type: "tool_call", toolName: "bash" });

    // Имя события берётся у Pi без переименования: цена решения названа в docs/hooks.md.
    assert.deepEqual(host.contributions, [{ kind: "hook", id: "watch-tools", event: "tool_call" }]);
    assert.deepEqual(seen, ["bash"]);
  });
});

describe("a tool of a plugin", () => {
  const parameters = z.object({ city: z.string(), days: z.number().optional() });

  it("is declared with its arguments as data", async () => {
    const host = installTestHost({ id: "weather" });

    await contribute.tool({
      id: "forecast",
      title: "Forecast",
      description: "говорит погоду в городе",
      parameters,
      invoke: () => "ясно",
    });

    assert.deepEqual(host.contributions, [
      {
        kind: "tool",
        id: "forecast",
        title: "Forecast",
        description: "говорит погоду в городе",
        parameters: z.toJSONSchema(parameters),
      },
    ]);
    assert.deepEqual(structuredClone(host.contributions), host.contributions);
  });

  it("answers a call with the text the model will read", async () => {
    const host = installTestHost({ id: "weather" });
    const seen: unknown[] = [];

    await contribute.tool({
      id: "forecast",
      description: "говорит погоду в городе",
      parameters,
      invoke: (toolArguments) => {
        seen.push(toolArguments);

        return `в ${toolArguments.city} ясно`;
      },
    });

    assert.deepEqual(await host.callTool("forecast", { city: "Тбилиси" }), {
      content: "в Тбилиси ясно",
      isError: false,
    });
    assert.deepEqual(seen, [{ city: "Тбилиси" }]);
  });

  it("keeps the mark of failure, so the model sees a failed call as failed", async () => {
    const host = installTestHost({ id: "weather" });

    await contribute.tool({
      id: "forecast",
      description: "говорит погоду в городе",
      parameters,
      invoke: () => ({ content: "город не найден", isError: true }),
    });

    assert.deepEqual(await host.callTool("forecast", { city: "Атлантида" }), {
      content: "город не найден",
      isError: true,
    });
  });

  it("refuses an outcome that is neither a text nor a text with a mark", async () => {
    const host = installTestHost({ id: "weather" });

    await contribute.tool({
      id: "forecast",
      description: "говорит погоду в городе",
      parameters,
      // @ts-expect-error — автор ошибся в форме исхода; проверка обязана поймать это и в рантайме.
      invoke: () => ({ temperature: 25 }),
    });

    await assert.rejects(
      () => host.callTool("forecast", { city: "Тбилиси" }),
      /the tool forecast returned neither a string nor \{ content: string \}/,
    );
  });

  it("names the tool the core asked about but the plugin never declared", async () => {
    const host = installTestHost({ id: "weather" });

    await assert.rejects(
      () => host.callTool("never-declared", {}),
      /no implementation for the tool never-declared/,
    );
  });
});

describe("a route of a plugin", () => {
  const request: PluginRouteRequest = {
    method: "GET",
    path: "board/:boardId",
    parameters: { boardId: "7" },
    query: { full: "yes" },
    headers: { accept: "application/json" },
    public: false,
  };

  it("declares the address and keeps the handler in the worker", async () => {
    const host = installTestHost({ id: "tasks" });

    await contribute.route({
      id: "board",
      title: "Board",
      method: "GET",
      path: "board/:boardId",
      handle: () => ({ body: "{}" }),
    });

    // Обработчик через границу не едет: в объявлении его нет вовсе, а само объявление обязано
    // пережить структурное клонирование (docs/web-api.md).
    assert.deepEqual(host.contributions, [
      { kind: "route", id: "board", title: "Board", method: "GET", path: "board/:boardId" },
    ]);
    assert.deepEqual(structuredClone(host.contributions), host.contributions);
  });

  it("reads a route without a method as a read", async () => {
    const host = installTestHost({ id: "tasks" });

    await contribute.route({ id: "board", path: "board", handle: () => ({}) });

    assert.deepEqual(host.contributions, [
      { kind: "route", id: "board", method: "GET", path: "board" },
    ]);
  });

  it("marks a public route with its own kind, not with a flag", async () => {
    const host = installTestHost({ id: "tasks" });

    await contribute.publicRoute({
      id: "github-webhook",
      method: "POST",
      path: "webhooks/github",
      handle: () => ({ status: 204 }),
    });

    assert.deepEqual(host.contributions, [
      { kind: "public-route", id: "github-webhook", method: "POST", path: "webhooks/github" },
    ]);
  });

  it("keeps route and public-route handlers distinct when their ids match", async () => {
    const host = installTestHost({ id: "tasks" });

    await contribute.route({
      id: "shared",
      path: "private",
      handle: () => ({ body: "private" }),
    });
    await contribute.publicRoute({
      id: "shared",
      path: "public",
      handle: () => ({ body: "public" }),
    });

    assert.deepEqual(await host.callRoute("shared", request), { body: "private" });
    assert.deepEqual(await host.callRoute("shared", { ...request, public: true }), {
      body: "public",
    });
  });

  it("answers a call with the response the dispatcher will write", async () => {
    const host = installTestHost({ id: "tasks" });
    const seen: PluginRouteRequest[] = [];

    await contribute.route({
      id: "board",
      path: "board/:boardId",
      handle: (incoming) => {
        seen.push(incoming);

        return { status: 200, headers: { "content-type": "application/json" }, body: '{"id":"7"}' };
      },
    });

    assert.deepEqual(await host.callRoute("board", request), {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"id":"7"}',
    });
    assert.deepEqual(seen, [request]);
  });

  it("names the route the core asked about but the plugin never declared", async () => {
    const host = installTestHost({ id: "tasks" });

    await assert.rejects(
      () => host.callRoute("never-declared", request),
      /no handler for the route never-declared/,
    );
  });

  it("refuses an answer that is not a response", async () => {
    const host = installTestHost({ id: "tasks" });

    // @ts-expect-error — автор ошибся в форме ответа; проверка обязана поймать это и в рантайме.
    await contribute.route({ id: "board", path: "board", handle: () => "просто текст" });

    await assert.rejects(
      () => host.callRoute("board", request),
      /the route board answered with something that is not a response/,
    );
  });
});

describe("the storage of a plugin", () => {
  it("keeps what it was given and answers undefined for what it was not", async () => {
    const host = installTestHost({ id: "tasks" });

    await storage.set("last-seen", { id: "42" });

    assert.deepEqual(await storage.get("last-seen"), { id: "42" });
    assert.equal(await storage.get("never-written"), undefined);
    assert.deepEqual(host.stored.get("last-seen"), { id: "42" });
  });

  it("lists its keys and forgets a deleted one", async () => {
    installTestHost({ id: "tasks" });

    await storage.set("b", 2);
    await storage.set("a", 1);

    assert.deepEqual(await storage.keys(), ["a", "b"]);

    await storage.delete("a");
    // Удаление того, чего нет, — не ошибка: платформа отвечает тем же «записано».
    await storage.delete("a");

    assert.deepEqual(await storage.keys(), ["b"]);
  });

  it("hands out the folder of the plugin", async () => {
    const host = installTestHost({ id: "tasks" });

    host.answerStorageDirectory("/data/plugin-files/data%3Atasks");

    assert.equal(await storage.directory(), "/data/plugin-files/data%3Atasks");
  });

  it("explains itself instead of failing on undefined without a host", async () => {
    await assert.rejects(() => storage.get("last-seen"), /sdk is not initialised/);
    await assert.rejects(() => storage.set("last-seen", 1), /sdk is not initialised/);
    await assert.rejects(() => storage.directory(), /sdk is not initialised/);
  });
});
