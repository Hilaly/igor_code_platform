import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import { emptyEnvironment, inMemoryVault } from "@sovereign/agent-runtime-pi/testing";
import { coreEventTypes, type BusEvent } from "@sovereign/protocol";

import { createEventBus } from "./event-bus.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createPluginProviders } from "./plugin-providers.ts";

const quietLogger = (): Logger =>
  createLogger({ source: "core", level: () => "debug", write: () => {} });

const plugin = { key: "data:reader", id: "reader", source: "data" as const };

function bridge(options: { credentials?: Record<string, unknown> } = {}) {
  const catalogue = createProviderCatalogue({
    credentials: inMemoryVault(options.credentials ?? {}),
    environment: emptyEnvironment(),
  });
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const events: BusEvent[] = [];

  bus.subscribe((event) => events.push(event));

  return {
    providers: createPluginProviders({ catalogue, bus, logger: quietLogger() }),
    events,
  };
}

describe("the provider bridge of a plugin", () => {
  it("hands the plugin the same catalogue the human sees", async () => {
    const { providers } = bridge();
    const answer = await providers.request(plugin, { kind: "list" });

    assert.ok(answer.kind === "list");
    assert.ok(answer.providers.length >= 38);
    assert.ok(answer.providers.every((provider) => provider.auth.kind === "unconfigured"));
  });

  it("says nothing about a credential value in the summary it hands over", async () => {
    const { providers } = bridge({
      credentials: { anthropic: { type: "api_key", key: "s3cret" } },
    });
    const answer = await providers.request(plugin, { kind: "list" });

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
    const known = await providers.request(plugin, { kind: "models", providerId: "anthropic" });
    const unknown = await providers.request(plugin, { kind: "models", providerId: "выдуманный" });

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
    const configured = await providers.request(plugin, { kind: "status", providerId: "anthropic" });
    const missing = await providers.request(plugin, { kind: "status", providerId: "выдуманный" });

    assert.deepEqual(configured, {
      kind: "status",
      status: { kind: "configured", type: "api_key", source: "stored credential" },
    });
    assert.deepEqual(missing, { kind: "status" });
  });

  it("tells everybody the catalogue changed when a plugin refreshes it", async () => {
    const { providers, events } = bridge();
    const answer = await providers.request(plugin, { kind: "refresh" });

    assert.ok(answer.kind === "refresh");
    assert.equal(answer.report.aborted, false);

    // Обновление меняет глобальное состояние: сделавший его плагин обязан быть виден остальным.
    assert.deepEqual(
      events.map((event) => event.type),
      [coreEventTypes.providersChanged],
    );
  });
});
