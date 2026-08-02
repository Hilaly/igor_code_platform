import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import {
  emptyEnvironment,
  inMemoryVault,
  scriptedProvider,
  type ScriptedStep,
} from "@sovereign/agent-runtime-pi/testing";
import { coreEventTypes, type BusEvent, type CustomProviderDefinition } from "@sovereign/protocol";
import type { LoginStep } from "@sovereign/sdk";

import { createEventBus } from "./platform/public.ts";
import { createLogger, type Logger } from "./platform/public.ts";
import { createPluginProviders } from "./plugin-providers.ts";
import { createProviderLogins } from "./providers/public.ts";

const quietLogger = (): Logger =>
  createLogger({ source: "core", level: () => "debug", write: () => {} });

const plugin = { key: "data:reader", id: "reader", source: "data" as const };

/** Шаги, уехавшие плагину, и идентификатор вызова, которым они ключуются. */
function collector(requestId = "1") {
  const steps: LoginStep[] = [];

  return {
    steps,
    call: {
      requestId,
      sendLoginStep: (step: LoginStep): void => {
        steps.push(step);
      },
    },
  };
}

function bridge(
  options: {
    credentials?: Record<string, unknown>;
    problem?: string;
    script?: ScriptedStep[];
  } = {},
) {
  const scripted = scriptedProvider({ script: options.script ?? [] });
  const vault = inMemoryVault(options.credentials ?? {});
  const credentials = { problem: () => options.problem };
  const catalogue = createProviderCatalogue({
    credentials: { ...vault, problem: () => options.problem },
    environment: emptyEnvironment(),
    additionalProviders: [scripted.provider],
  });
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const events: BusEvent[] = [];

  bus.subscribe((event) => events.push(event));

  const logins = createProviderLogins({ runner: catalogue, logger: quietLogger() });

  return {
    providers: createPluginProviders({
      catalogue,
      logins,
      credentials,
      bus,
      logger: quietLogger(),
    }),
    logins,
    scripted,
    events,
  };
}

/** Ждёт, пока обещания диалога успеют разойтись: мост отвечает через микрозадачи. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("the provider bridge of a plugin", () => {
  it("hands the plugin the same catalogue the human sees", async () => {
    const { providers } = bridge();
    const answer = await providers.request(plugin, { kind: "list" }, collector().call);

    assert.ok(answer.kind === "list");
    assert.ok(answer.providers.length >= 38);
    assert.ok(answer.providers.every((provider) => provider.auth.kind === "unconfigured"));
  });

  it("says nothing about a credential value in the summary it hands over", async () => {
    const { providers } = bridge({
      credentials: { anthropic: { type: "api_key", key: "s3cret" } },
    });
    const answer = await providers.request(plugin, { kind: "list" }, collector().call);

    assert.ok(answer.kind === "list");

    const anthropic = answer.providers.find((provider) => provider.id === "anthropic");

    // Статус — да, значение — никогда: единственный писатель кредов платформа, а читателя нет.
    assert.deepEqual(anthropic?.auth, {
      kind: "configured",
      type: "api_key",
      source: "stored credential",
    });
    assert.equal(JSON.stringify(answer).includes("s3cret"), false);
  });

  it("hands over the models of one provider and nothing for a provider nobody registered", async () => {
    const { providers } = bridge();
    const known = await providers.request(
      plugin,
      { kind: "models", providerId: "anthropic" },
      collector().call,
    );
    const unknown = await providers.request(
      plugin,
      { kind: "models", providerId: "выдуманный" },
      collector().call,
    );

    assert.ok(known.kind === "models");
    assert.ok((known.models ?? []).length > 0);
    assert.ok(known.models?.every((model) => model.providerId === "anthropic"));

    assert.ok(unknown.kind === "models");
    assert.equal(unknown.models, undefined);
  });

  it("answers the status of one provider without walking the whole catalogue", async () => {
    const { providers } = bridge({
      credentials: { anthropic: { type: "api_key", key: "s3cret" } },
    });
    const configured = await providers.request(
      plugin,
      { kind: "status", providerId: "anthropic" },
      collector().call,
    );
    const missing = await providers.request(
      plugin,
      { kind: "status", providerId: "выдуманный" },
      collector().call,
    );

    assert.deepEqual(configured, {
      kind: "status",
      status: { kind: "configured", type: "api_key", source: "stored credential" },
    });
    assert.deepEqual(missing, { kind: "status" });
  });

  it("tells everybody the catalogue changed when a plugin refreshes it", async () => {
    const { providers, events } = bridge();
    const answer = await providers.request(plugin, { kind: "refresh" }, collector().call);

    assert.ok(answer.kind === "refresh");
    assert.equal(answer.report.aborted, false);

    // Обновление меняет глобальное состояние: сделавший его плагин обязан быть виден остальным.
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providersChanged],
    );
  });
});

describe("a login started by a plugin", () => {
  it("carries the steps to the plugin and its answer back to the provider", async () => {
    const { providers, scripted, logins } = bridge({
      script: [
        { say: { type: "info", message: "открой страницу провайдера" } },
        { ask: { type: "secret", message: "ключ?" } },
      ],
    });
    const asked = collector();
    const finished = providers.request(
      plugin,
      { kind: "login", providerId: "scripted", method: "api_key" },
      asked.call,
    );

    await settled();

    // Попытка видна человеку, но отвечает на неё плагин: у одного вопроса один отвечающий.
    const attempt = logins.list()[0];

    assert.equal(attempt?.origin, "plugin");
    assert.equal(attempt?.answerable, false);

    const prompt = asked.steps.find((step) => step.kind === "prompt");

    assert.ok(prompt?.kind === "prompt");
    assert.deepEqual(
      asked.steps.map((step) => step.kind),
      ["notice", "prompt"],
    );

    providers.reply(plugin, {
      kind: "login-answer",
      requestId: "1",
      stepId: prompt.prompt.stepId,
      value: "sk-тест",
    });

    assert.deepEqual(await finished, { kind: "login", conclusion: { kind: "succeeded" } });
    assert.deepEqual(scripted.answers, ["sk-тест"]);
    assert.deepEqual(logins.list(), []);
  });

  it("ends as cancelled when the plugin refuses to answer", async () => {
    const { providers } = bridge({ script: [{ ask: { type: "secret", message: "ключ?" } }] });
    const asked = collector();
    const finished = providers.request(
      plugin,
      { kind: "login", providerId: "scripted", method: "api_key" },
      asked.call,
    );

    await settled();
    providers.reply(plugin, { kind: "login-cancel", requestId: "1" });

    assert.deepEqual(await finished, { kind: "login", conclusion: { kind: "cancelled" } });
  });

  it("refuses a second login into a provider somebody is already entering", async () => {
    const { providers, logins } = bridge({
      script: [{ ask: { type: "secret", message: "ключ?" } }],
    });

    logins.start({
      providerId: "scripted",
      method: "api_key",
      origin: "session",
      owner: "the-session",
    });

    const answer = await providers.request(
      plugin,
      { kind: "login", providerId: "scripted", method: "api_key" },
      collector().call,
    );

    // Автоотмена отвергнута: плагин убивал бы наполовину пройденный диалог человека.
    assert.deepEqual(answer, {
      kind: "failed",
      reason: "a login into scripted is already running",
    });
  });

  it("refuses to start a login it could not save the result of", async () => {
    const { providers, logins } = bridge({ problem: "credentials.json is not valid json" });
    const answer = await providers.request(
      plugin,
      { kind: "login", providerId: "scripted", method: "api_key" },
      collector().call,
    );

    assert.deepEqual(answer, { kind: "failed", reason: "credentials.json is not valid json" });
    assert.deepEqual(logins.list(), []);
  });

  it("frees the provider when the plugin behind the login is gone", async () => {
    const { providers, logins } = bridge({
      script: [{ ask: { type: "secret", message: "ключ?" } }],
    });
    const finished = providers.request(
      plugin,
      { kind: "login", providerId: "scripted", method: "api_key" },
      collector().call,
    );

    await settled();
    assert.ok(logins.runningFor("scripted"));

    providers.remove(plugin.key);

    assert.deepEqual(await finished, { kind: "login", conclusion: { kind: "cancelled" } });
    assert.equal(logins.runningFor("scripted"), undefined);
  });

  it("answers nothing to a step of a login that is not the plugin's own", async () => {
    const { providers, logins } = bridge({
      script: [{ ask: { type: "secret", message: "ключ?" } }],
    });
    const started = logins.start({
      providerId: "scripted",
      method: "api_key",
      origin: "session",
      owner: "the-session",
    });

    assert.ok(started.kind === "started");
    await settled();

    // Ответ на чужой шаг ничего не двигает: у попытки есть владелец, и это не плагин.
    providers.reply(plugin, {
      kind: "login-answer",
      requestId: "1",
      stepId: `${started.attempt.attemptId}-1`,
      value: "sk-чужой",
    });

    await settled();
    assert.ok(logins.runningFor("scripted"));
  });
});

describe("a logout asked for by a plugin", () => {
  it("removes the credential and tells the bus", async () => {
    const { providers, events } = bridge({
      credentials: { anthropic: { type: "api_key", key: "s3cret" } },
    });
    const answer = await providers.request(
      plugin,
      { kind: "logout", providerId: "anthropic" },
      collector().call,
    );
    const status = await providers.request(
      plugin,
      { kind: "status", providerId: "anthropic" },
      collector().call,
    );

    assert.deepEqual(answer, { kind: "logout" });
    assert.deepEqual(status, { kind: "status", status: { kind: "unconfigured" } });
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providerLogout],
    );
  });

  it("cancels a running login first, so it cannot write the credential back", async () => {
    const { providers, logins } = bridge({
      script: [{ ask: { type: "secret", message: "ключ?" } }],
    });
    const finished = providers.request(
      plugin,
      { kind: "login", providerId: "scripted", method: "api_key" },
      collector().call,
    );

    await settled();
    await providers.request(plugin, { kind: "logout", providerId: "scripted" }, collector().call);

    assert.deepEqual(await finished, { kind: "login", conclusion: { kind: "cancelled" } });
    assert.equal(logins.runningFor("scripted"), undefined);
  });

  it("refuses to write over a credentials file it could not read", async () => {
    const { providers } = bridge({ problem: "credentials.json is not valid json" });
    const answer = await providers.request(
      plugin,
      { kind: "logout", providerId: "scripted" },
      collector().call,
    );

    assert.deepEqual(answer, { kind: "failed", reason: "credentials.json is not valid json" });
  });
});

const vendor: CustomProviderDefinition = {
  id: "vendor-local",
  name: "Vendor Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions",
  apiKey: { label: "Vendor key" },
  models: [{ id: "vendor-large", name: "Vendor Large", contextWindow: 32_000, maxTokens: 4_096 }],
};

const another = { key: "data:other", id: "other", source: "data" as const };

describe("a provider registered by a plugin", () => {
  it("joins the catalogue and tells the bus the catalogue changed", async () => {
    const { providers, events } = bridge();
    const answer = await providers.request(
      plugin,
      { kind: "register", definition: vendor },
      collector().call,
    );
    const list = await providers.request(plugin, { kind: "list" }, collector().call);

    assert.deepEqual(answer, { kind: "register" });
    assert.ok(list.kind === "list");
    assert.equal(list.providers.find((provider) => provider.id === vendor.id)?.custom, true);
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providersChanged],
    );
  });

  it("refuses an identifier somebody already holds instead of replacing it", async () => {
    const { providers, events } = bridge();
    const answer = await providers.request(
      plugin,
      { kind: "register", definition: { ...vendor, id: "anthropic" } },
      collector().call,
    );

    assert.deepEqual(answer, {
      kind: "failed",
      reason: "the provider anthropic is already registered",
    });
    assert.deepEqual(events, []);
  });

  it("goes away with the plugin, and the bus hears about it", async () => {
    const { providers, events } = bridge();

    await providers.request(plugin, { kind: "register", definition: vendor }, collector().call);
    providers.remove(plugin.key);

    const list = await providers.request(plugin, { kind: "list" }, collector().call);

    assert.ok(list.kind === "list");
    assert.equal(
      list.providers.some((provider) => provider.id === vendor.id),
      false,
    );
    // Оба перехода видны: появился и исчез.
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providersChanged, coreEventTypes.providersChanged],
    );
  });

  it("says nothing to the bus when the plugin that left had no providers", () => {
    const { providers, events } = bridge();

    providers.remove(plugin.key);

    assert.deepEqual(events, []);
  });

  it("cannot be taken away by another plugin", async () => {
    const { providers } = bridge();

    await providers.request(plugin, { kind: "register", definition: vendor }, collector().call);

    const answer = await providers.request(
      another,
      { kind: "unregister", providerId: vendor.id },
      collector().call,
    );
    const list = await providers.request(plugin, { kind: "list" }, collector().call);

    assert.deepEqual(answer, {
      kind: "failed",
      reason: "the provider vendor-local was not registered by this plugin",
    });
    assert.ok(list.kind === "list");
    assert.ok(list.providers.some((provider) => provider.id === vendor.id));
  });

  it("is taken away by its own plugin before it is unloaded", async () => {
    const { providers } = bridge();

    await providers.request(plugin, { kind: "register", definition: vendor }, collector().call);

    const answer = await providers.request(
      plugin,
      { kind: "unregister", providerId: vendor.id },
      collector().call,
    );
    const list = await providers.request(plugin, { kind: "list" }, collector().call);

    assert.deepEqual(answer, { kind: "unregister" });
    assert.ok(list.kind === "list");
    assert.equal(
      list.providers.some((provider) => provider.id === vendor.id),
      false,
    );

    // Освободившийся идентификатор снова свободен: занятость про живого провайдера, а не про имя.
    assert.deepEqual(
      await providers.request(plugin, { kind: "register", definition: vendor }, collector().call),
      { kind: "register" },
    );
  });

  it("can be logged into like any other, and the credential outlives it", async () => {
    const { providers } = bridge();

    await providers.request(plugin, { kind: "register", definition: vendor }, collector().call);

    const asked = collector();
    const finished = providers.request(
      plugin,
      { kind: "login", providerId: vendor.id, method: "api_key" },
      asked.call,
    );

    await settled();

    const prompt = asked.steps.find((step) => step.kind === "prompt");

    assert.ok(prompt?.kind === "prompt");
    providers.reply(plugin, {
      kind: "login-answer",
      requestId: "1",
      stepId: prompt.prompt.stepId,
      value: "sk-вендор",
    });

    assert.deepEqual(await finished, { kind: "login", conclusion: { kind: "succeeded" } });

    // Провайдер уходит вместе с плагином, а кред остаётся в общем хранилище и ждёт его возврата.
    providers.remove(plugin.key);
    await providers.request(plugin, { kind: "register", definition: vendor }, collector().call);

    assert.deepEqual(
      await providers.request(plugin, { kind: "status", providerId: vendor.id }, collector().call),
      {
        kind: "status",
        status: { kind: "configured", type: "api_key", source: "stored credential" },
      },
    );
  });
});
