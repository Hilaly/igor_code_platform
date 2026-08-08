import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { setTimeout as wait } from "node:timers/promises";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import {
  emptyEnvironment,
  inMemoryVault,
  scriptedProvider,
  type ScriptedStep,
} from "@sovereign/agent-runtime-pi/testing";
import {
  defaultPreferences,
  isPluginBusEvent,
  type BusEvent,
  type LogRecord,
  type LogSource,
  type PluginStatus,
  type Preferences,
} from "@sovereign/protocol";

import { createContributionRegistry } from "./contribution-registry.ts";
import { createPluginHooks } from "./plugin-hooks.ts";
import { createPluginProviders } from "./plugin-providers.ts";
import { createHookDispatcher } from "../sessions/public.ts";
import { carryLoginSteps } from "../providers/public.ts";
import { createProviderLogins } from "../providers/public.ts";
import { createEventBus, type EventBus } from "../platform/public.ts";
import { createLogger, type Logger } from "../platform/public.ts";
import {
  createPluginSupervisor,
  type CancelScheduled,
  type CreatePluginSupervisorOptions,
  type PluginSupervisor,
} from "./plugin-supervisor.ts";
import { discoverPlugins, type PluginDiscovery } from "./plugin-sources.ts";

const fixtures = join(import.meta.dirname, "fixtures");
const discovered = discoverPlugins([{ source: "data", directory: fixtures }]);

/** Фикстуры лежат вместе, а тесту нужны по одной: остальные только мешали бы читать журнал. */
function only(...ids: string[]): PluginDiscovery {
  return {
    plugins: discovered.plugins.filter((plugin) => ids.includes(plugin.id)),
    refused: discovered.refused.filter(
      (plugin) => plugin.id !== undefined && ids.includes(plugin.id),
    ),
  };
}

const preferences = (plugins: Preferences["plugins"]): Preferences => ({
  ...defaultPreferences,
  plugins,
});

const enabled = (...keys: string[]): Preferences =>
  preferences(
    Object.fromEntries(keys.map((key) => [key, { enabled: true, disabledContributions: [] }])),
  );

const disabled = (...keys: string[]): Preferences =>
  preferences(
    Object.fromEntries(keys.map((key) => [key, { enabled: false, disabledContributions: [] }])),
  );

type Journal = {
  records: LogRecord[];
  logger: Logger;
  pluginLogger: (source: LogSource) => Logger;
  bus: EventBus;
  /** Всё, что попало на шину: переходы, смены набора вкладов и события плагинов. */
  events: BusEvent[];
  /** Ждёт событие на шине: оно приходит асинхронно, из воркера. */
  waitForEvent: (predicate: (event: BusEvent) => boolean, hint: string) => Promise<BusEvent>;
  /** Ждёт запись, удовлетворяющую условию: состояния приходят асинхронно, из воркера. */
  waitFor: (predicate: (record: LogRecord) => boolean, hint: string) => Promise<LogRecord>;
};

function journal(): Journal {
  const records: LogRecord[] = [];
  const waiters = new Set<() => void>();

  const write = (record: LogRecord): void => {
    records.push(record);

    for (const waiter of [...waiters]) {
      waiter();
    }
  };

  const make = (source: LogSource): Logger => createLogger({ source, level: () => "debug", write });

  const events: BusEvent[] = [];
  const bus = createEventBus({
    // Тест не прощает упавшего подписчика: свой подписчик здесь один, и падать ему не с чего.
    onListenerError: (cause) => {
      throw cause;
    },
  });

  const eventWaiters = new Set<() => void>();

  bus.subscribe((event) => {
    events.push(event);

    for (const waiter of [...eventWaiters]) {
      waiter();
    }
  });

  return {
    records,
    logger: make("core"),
    pluginLogger: make,
    bus,
    events,
    waitForEvent: (predicate, hint) =>
      new Promise((resolve, reject) => {
        const check = (): void => {
          const found = events.find(predicate);

          if (found !== undefined) {
            eventWaiters.delete(check);
            clearTimeout(timer);
            resolve(found);
          }
        };

        const timer = setTimeout(() => {
          eventWaiters.delete(check);
          reject(new Error(`no bus event for ${hint}; seen: ${JSON.stringify(events)}`));
        }, 5_000);

        eventWaiters.add(check);
        check();
      }),
    waitFor: (predicate, hint) =>
      new Promise((resolve, reject) => {
        const check = (): void => {
          const found = records.find(predicate);

          if (found !== undefined) {
            waiters.delete(check);
            clearTimeout(timer);
            resolve(found);
          }
        };

        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`no log record for ${hint}; seen: ${JSON.stringify(records)}`));
        }, 5_000);

        waiters.add(check);
        check();
      }),
  };
}

const reachedState = (plugin: string, state: string) => (record: LogRecord) =>
  record.message === "plugin lifecycle" && record["plugin"] === plugin && record["state"] === state;

/** Планировщик под контролем теста: задержки перезапуска проверяются числами, а не ожиданием. */
function manualClock() {
  const scheduled: { delay: number; callback: () => void }[] = [];
  let current = 0;

  return {
    delays: () => scheduled.map((entry) => entry.delay),
    now: () => current,
    advance: (milliseconds: number) => {
      current += milliseconds;
    },
    fireAll: () => {
      const pending = scheduled.splice(0, scheduled.length);

      for (const entry of pending) {
        entry.callback();
      }
    },
    schedule: (callback: () => void, delay: number): CancelScheduled => {
      const entry = { delay, callback };
      scheduled.push(entry);

      return () => {
        const index = scheduled.indexOf(entry);

        if (index >= 0) {
          scheduled.splice(index, 1);
        }
      };
    },
  };
}

/**
 * Настоящий каталог с двойником провайдера, настоящий реестр попыток и настоящий мост: провайдеры
 * обязаны проверяться на том, что отдаёт рантайм, а не на фальшивом ответе. В настоящих провайдеров
 * тест не входит — креды и окружение пусты.
 */
function providerWorld(recorded: Journal, script: ScriptedStep[] = []) {
  const scripted = scriptedProvider({ script });
  const credentials = inMemoryVault();
  const catalogue = createProviderCatalogue({
    credentials,
    environment: emptyEnvironment(),
    additionalProviders: [scripted.provider],
  });
  const logins = createProviderLogins({ runner: catalogue, logger: recorded.logger });
  const bridge = createPluginProviders({
    catalogue,
    logins,
    credentials,
    bus: recorded.bus,
    logger: recorded.logger,
  });

  return {
    scripted,
    catalogue,
    logins,
    /** Три хука супервизора одним объектом: маршрутизация у него, логика — здесь. */
    hooks: {
      // Второй канал — сессии — здесь не проверяется: супервизор только маршрутизирует, а вид
      // запроса разводит `isSessionRequest` в проводке демона.
      onRequest: ((plugin, request, call) =>
        bridge.request(
          plugin,
          request as Parameters<typeof bridge.request>[1],
          call,
        )) satisfies NonNullable<CreatePluginSupervisorOptions["onRequest"]>,
      onLoginReply: bridge.reply,
      onPluginGone: bridge.remove,
    },
  };
}

let running: PluginSupervisor | undefined;

afterEach(async () => {
  await running?.stopAll();
  running = undefined;
});

function revisionOf(supervisor: PluginSupervisor, key: string): string {
  const revision = supervisor.statuses().find((status) => status.key === key)?.browser?.revision;

  assert.ok(revision !== undefined, `${key} reports no browser revision`);

  return revision;
}

const lifecycleEvents = (events: BusEvent[], key: string): PluginStatus[] =>
  events
    .flatMap((event) =>
      !isPluginBusEvent(event) && event.type === "core.plugin.lifecycle" ? [event.payload] : [],
    )
    .filter((status) => status.key === key);

describe("createPluginSupervisor", () => {
  it("publishes the same status it would answer with in a snapshot", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    const published = lifecycleEvents(recorded.events, "data:hello");

    assert.deepEqual(
      published.map((status) => status.state),
      ["discovered", "starting", "running"],
    );

    // Последнее событие обязано совпасть со снимком до поля: расхождение между потоком и снимком
    // делает догон бессмысленным (docs/event-bus.md).
    assert.deepEqual(
      published.at(-1),
      supervisor.statuses().find((status) => status.key === "data:hello"),
    );
  });

  it("publishes the effective contributions with the registry revision", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      publishContributionChanges: () =>
        recorded.bus.publish("core.contributions.changed", { revision: registry.revision() }),
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    const changes = recorded.events.flatMap((event) =>
      !isPluginBusEvent(event) && event.type === "core.plugin.contributions" ? [event.payload] : [],
    );
    const last = changes.at(-1);

    assert.equal(last?.revision, registry.revision());
    assert.deepEqual(last?.contributions, registry.resolved());
    assert.equal((last?.contributions.length ?? 0) > 0, true);
    assert.deepEqual(
      recorded.events.filter((event) => event.type === "core.contributions.changed"),
      [{ type: "core.contributions.changed", payload: { revision: registry.revision() } }],
    );
  });

  it("puts an event published by a plugin on the bus with its namespace and origin", async () => {
    const recorded = journal();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
    });
    running = supervisor;

    await supervisor.apply(only("publisher"), enabled("data:publisher"));

    const event = await recorded.waitForEvent(
      (event) => isPluginBusEvent(event) && event.type === "publisher.task.created",
      "the event published by the plugin",
    );

    assert.deepEqual(event, {
      type: "publisher.task.created",
      payload: { id: "42" },
      plugin: { key: "data:publisher", id: "publisher", source: "data" },
    });
  });

  it("carries an event from the worker of one plugin to the worker of another", async () => {
    const recorded = journal();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
    });
    running = supervisor;

    await supervisor.apply(
      only("publisher", "subscriber"),
      enabled("data:publisher", "data:subscriber"),
    );

    const record = await recorded.waitFor(
      (record) => record.message === "subscriber got the event",
      "the subscriber reacting to the event",
    );

    assert.equal(record.source, "plugin:subscriber");
    assert.deepEqual(record["payload"], { id: "42" });
    assert.equal(record["from"], "publisher");
  });

  it("leaves no second subscription behind when the plugin is reloaded", async () => {
    const recorded = journal();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
    });
    running = supervisor;

    const deliverOnce = async (hint: string): Promise<number> => {
      const before = recorded.records.filter(
        (record) => record.message === "subscriber got the event",
      ).length;

      recorded.bus.publishFromPlugin({
        type: "publisher.task.created",
        payload: { id: "42" },
        plugin: { key: "data:publisher", id: "publisher", source: "data" },
      });

      await recorded.waitFor(
        (record) =>
          record.message === "subscriber got the event" &&
          recorded.records.filter((seen) => seen.message === "subscriber got the event").length >
            before,
        hint,
      );

      // Дубликат пришёл бы следующим сообщением, а не через секунду: доставка синхронная, задержка
      // здесь только на путь через воркер.
      await wait(100);

      return (
        recorded.records.filter((record) => record.message === "subscriber got the event").length -
        before
      );
    };

    await supervisor.apply(only("subscriber"), enabled("data:subscriber"));
    await recorded.waitFor(reachedState("data:subscriber", "running"), "subscriber running");
    assert.equal(await deliverOnce("the first delivery"), 1);

    await supervisor.reload([
      { directory: join(fixtures, "subscriber"), fileResourcesChanged: false },
    ]);
    await recorded.waitFor(
      (record) =>
        record.message === "plugin lifecycle" &&
        record["plugin"] === "data:subscriber" &&
        record["state"] === "running" &&
        recorded.records.filter(
          (seen) => seen.message === "plugin lifecycle" && seen["state"] === "running",
        ).length > 1,
      "subscriber running again",
    );

    assert.equal(await deliverOnce("the delivery after the reload"), 1);
  });

  it("answers the plugin about providers, models and their status", async () => {
    const recorded = journal();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
      ...providerWorld(recorded).hooks,
    });
    running = supervisor;

    await supervisor.apply(only("provider-reader"), enabled("data:provider-reader"));

    const record = await recorded.waitFor(
      (record) => record.message === "provider-reader looked around",
      "the plugin reporting what it saw",
    );

    assert.equal(typeof record["providers"], "number");
    assert.ok((record["providers"] as number) >= 38);
    // Провайдер, добавленный в каталог, виден плагину: коллекция у плагина и у человека одна.
    assert.equal(record["scripted"], true);
    assert.ok((record["models"] as number) > 0);
    assert.equal(record["model"], "anthropic");
    assert.equal(record["status"], "unconfigured");
    assert.equal(record["nobody"], true);
    assert.equal(record["secrets"], 0);
  });

  it("answers a request with a refusal when nothing bridges the catalogue", async () => {
    const recorded = journal();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
    });
    running = supervisor;

    // Молчание оставило бы плагин на `await` навсегда, и выглядело бы это как зависший activate.
    await supervisor.apply(only("provider-reader"), enabled("data:provider-reader"));
    await recorded.waitFor(
      (record) =>
        reachedState("data:provider-reader", "failed")(record) &&
        /answers no requests from plugins/.test(String(record["reason"])),
      "the plugin failing with the reason",
    );
  });

  it("walks a whole interactive login through the channel of the plugin", async () => {
    const recorded = journal();
    const world = providerWorld(recorded, [
      { say: { type: "info", message: "открой страницу провайдера" } },
      { ask: { type: "secret", message: "ключ?" } },
    ]);
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
      ...world.hooks,
    });
    running = supervisor;

    await supervisor.apply(only("provider-guest"), enabled("data:provider-guest"));

    const record = await recorded.waitFor(
      (record) => record.message === "provider-guest finished a login",
      "the plugin finishing its login",
    );

    // Вопрос дошёл до плагина, ответ дошёл до провайдера, кред записала платформа.
    assert.deepEqual(world.scripted.answers, ["ответ на secret"]);
    assert.equal(record["conclusion"], "succeeded");
    assert.deepEqual(record["heard"], ["info"]);
    assert.equal(record["before"], "configured");
    // Выход — операция того же плагина, и провайдер после неё не настроен.
    assert.equal(record["after"], "unconfigured");

    assert.deepEqual(world.logins.list(), []);
  });

  it("keeps the steps of a plugin login out of the event stream", async () => {
    const recorded = journal();
    const world = providerWorld(recorded, [
      { say: { type: "info", message: "открой страницу провайдера" } },
      { ask: { type: "secret", message: "ключ?" } },
    ]);
    const frames: unknown[] = [];

    carryLoginSteps({ logins: world.logins, events: { emit: (frame) => frames.push(frame) } });

    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
      ...world.hooks,
    });
    running = supervisor;

    await supervisor.apply(only("provider-guest"), enabled("data:provider-guest"));
    await recorded.waitFor(
      (record) => record.message === "provider-guest finished a login",
      "the plugin finishing its login",
    );

    // Шаги попытки плагина едут в его воркер и никуда больше: окажись они ещё и в потоке, у одного
    // вопроса стало бы два отвечающих (docs/models-and-providers.md).
    assert.deepEqual(frames, []);
  });

  it("frees the provider when a plugin is unloaded in the middle of a login", async () => {
    const recorded = journal();
    const world = providerWorld(recorded, [{ ask: { type: "secret", message: "ключ?" } }]);
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
      ...world.hooks,
    });
    running = supervisor;

    await supervisor.apply(only("provider-hesitant"), enabled("data:provider-hesitant"));
    await recorded.waitFor(
      (record) => record.message === "provider-hesitant started a login it will not finish",
      "the plugin starting a login",
    );

    while (world.logins.runningFor("scripted") === undefined) {
      await wait(10);
    }

    await supervisor.apply(only("provider-hesitant"), disabled("data:provider-hesitant"));

    // Гашение доезжает до конца через рантайм: попытка снимается, когда его вызов входа отклонился.
    await recorded.waitFor(
      (record) => record.message === "a provider login ended without a credential",
      "the login of the unloaded plugin ending",
    );

    // Мёртвый воркер не держит провайдера занятым: иначе войти было бы нельзя до перезапуска демона.
    assert.equal(world.logins.runningFor("scripted"), undefined);
    assert.deepEqual(world.logins.list(), []);
  });

  it("keeps the provider a plugin registered while it lives and takes it away with it", async () => {
    const recorded = journal();
    const world = providerWorld(recorded);
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
      ...world.hooks,
    });
    running = supervisor;

    const vendor = only("provider-vendor").plugins[0];
    assert.ok(vendor !== undefined);

    const registrations = async (): Promise<string[]> =>
      (await world.catalogue.snapshot()).providers
        .filter((provider) => provider.custom)
        .map((provider) => provider.id);

    const changes = (): number =>
      recorded.events.filter((event) => event.type === "core.providers.changed").length;

    await supervisor.apply(only("provider-vendor"), enabled("data:provider-vendor"));

    const record = await recorded.waitFor(
      (record) => record.message === "provider-vendor registered a provider",
      "the plugin registering a provider",
    );

    assert.deepEqual(record["custom"], ["vendor-local"]);
    assert.deepEqual(record["models"], ["vendor-large", "vendor-small"]);
    // Занятый идентификатор — отказ операции, а не замена встроенного провайдера.
    assert.match(String(record["refusal"]), /the provider anthropic is already registered/);
    assert.deepEqual(await registrations(), ["vendor-local"]);
    assert.equal(changes(), 1);

    // Перезагрузка — это выгрузка и возврат: провайдер уходит и регистрируется заново в `activate`.
    await supervisor.reload([{ directory: vendor.directory, fileResourcesChanged: false }]);
    await recorded.waitFor(
      (record) =>
        recorded.records.filter((seen) => seen.message === "provider-vendor registered a provider")
          .length === 2 && record.message === "provider-vendor registered a provider",
      "the plugin registering a provider again",
    );

    assert.deepEqual(await registrations(), ["vendor-local"]);

    await supervisor.apply(only("provider-vendor"), disabled("data:provider-vendor"));

    // Выключение снимает всё, что плагин зарегистрировал, — провайдера в том числе.
    assert.deepEqual(await registrations(), []);
    // Оба перехода видны на шине: и появление, и исчезновение.
    assert.ok(changes() >= 2);
  });

  it("says nothing about contributions when the effective set did not change", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      publishContributionChanges: () =>
        recorded.bus.publish("core.contributions.changed", { revision: registry.revision() }),
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    const before = recorded.events.filter(
      (event) => event.type === "core.plugin.contributions",
    ).length;
    const invalidationsBefore = recorded.events.filter(
      (event) => event.type === "core.contributions.changed",
    ).length;

    // Тот же набор предпочтений: плагин остаётся запущенным, реестр не трогается.
    await supervisor.apply(only("hello"), enabled("data:hello"));

    assert.equal(
      recorded.events.filter((event) => event.type === "core.plugin.contributions").length,
      before,
    );
    assert.equal(
      recorded.events.filter((event) => event.type === "core.contributions.changed").length,
      invalidationsBefore,
    );
  });

  it("does not publish the plugin snapshot for a standalone-only registry change", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    registry.applyStandalone({
      rootKey: "user:skills:sovereign",
      source: "sovereign",
      precedence: 300,
      scope: "user",
      contributions: [],
    });
    await supervisor.apply(only("hello"), disabled("data:hello"));

    assert.deepEqual(
      recorded.events.filter((event) => event.type === "core.plugin.contributions"),
      [],
    );
  });

  it("starts an enabled plugin and stamps its log lines with its own source", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    const line = recorded.records.find((record) => record.message === "hello is up");

    assert.equal(line?.source, "plugin:hello");
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:hello")?.state,
      "running",
    );
  });

  it("keeps a plugin nobody enabled out of the worker pool", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), preferences({}));

    // Не «обнаружен»: решение применено, и оно — «выключен» (docs/plugins.md). Переход виден в журнале
    // и без воркера: человеку нужно подтверждение, а не молчание.
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:hello")?.state,
      "disabled",
    );
    assert.equal(recorded.records.some(reachedState("data:hello", "disabled")), true);
    assert.equal(
      recorded.records.some((record) => record.message === "hello is up"),
      false,
    );
  });

  it("ignores contributions and activated from a worker stopped during activate", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;
    const plugin = only("late-activation").plugins[0];
    assert.ok(plugin !== undefined);
    const release = join(plugin.directory, "src", "release");
    rmSync(release, { force: true });

    try {
      await supervisor.apply(only("late-activation"), enabled("data:late-activation"));
      await recorded.waitFor(
        (record) => record.message === "late activation is waiting",
        "activate waiting",
      );

      const disabling = supervisor.apply(only("late-activation"), disabled("data:late-activation"));
      await recorded.waitFor(reachedState("data:late-activation", "stopping"), "stop started");
      writeFileSync(release, "continue\n");
      await disabling;

      assert.equal(recorded.records.some(reachedState("data:late-activation", "running")), false);
      assert.deepEqual(registry.pluginContributions(), []);
      assert.equal(registry.revision(), 0);
      assert.equal(
        supervisor.statuses().find((status) => status.key === "data:late-activation")?.state,
        "disabled",
      );
    } finally {
      rmSync(release, { force: true });
    }
  });

  it("runs plugin code written with non-erasable typescript", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("typescripty"), enabled("data:typescripty"));
    await recorded.waitFor(
      (record) => record.message === "TYPESCRIPTY IS UP",
      "the enum-using plugin to speak",
    );
  });

  it("puts the contributions declared during activate into the registry", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    assert.deepEqual(
      registry.resolved().map((registration) => [registration.id, registration.pluginKey]),
      [["hello.board", "data:hello"]],
    );
  });

  it("publishes file and programmatic contributions atomically after activation", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("file-resources"), enabled("data:file-resources"));
    assert.deepEqual(registry.pluginContributions(), []);
    await recorded.waitFor(
      reachedState("data:file-resources", "running"),
      "file-resources running",
    );

    const registrations = registry.pluginContributions();
    assert.deepEqual(
      registrations.map((registration) => [registration.kind, registration.id]),
      [
        ["agent", "file-resources.helper"],
        ["custom", "file-resources.board"],
        ["skill", "file-resources.review"],
      ],
    );
    assert.equal(registry.revision(), 1);

    const status = supervisor.statuses().find((entry) => entry.key === "data:file-resources");
    assert.match(status?.contributionProblems?.[0] ?? "", /agents\/broken\/AGENT\.md/);
    assert.match(status?.contributionProblems?.[0] ?? "", /description is required/);
    const resources = registry.fileResourcesForProject("any");
    assert.equal(
      resources.resources.some(
        (resource) => resource.state === "invalid" && resource.path.endsWith("broken/AGENT.md"),
      ),
      true,
    );
  });

  it("excludes only a file/programmatic duplicate from the plugin snapshot", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("file-resource-conflict"), enabled("data:file-resource-conflict"));
    await recorded.waitFor(
      reachedState("data:file-resource-conflict", "running"),
      "file-resource-conflict running",
    );

    assert.deepEqual(
      registry.pluginContributions().map((registration) => registration.id),
      ["file-resource-conflict.board"],
    );
    const status = supervisor
      .statuses()
      .find((entry) => entry.key === "data:file-resource-conflict");
    assert.match(status?.contributionProblems?.[0] ?? "", /declared 2 times/);
    const resources = registry.fileResourcesForProject("any");
    assert.equal(resources.resources[0]?.path.endsWith("agents/agent/AGENT.md"), true);
    assert.match(resources.diagnostics[0]?.message ?? "", /also declared programmatically/);
  });

  it("carries the rejected contribution as a reason on the status of a running plugin", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("problem"), enabled("data:problem"));
    await recorded.waitFor(reachedState("data:problem", "running"), "problem running");

    // Кривой вклад не роняет плагин: остальные его вклады действуют.
    assert.deepEqual(
      registry.resolved().map((registration) => registration.id),
      ["problem.board"],
    );

    const status = supervisor.statuses().find((entry) => entry.key === "data:problem");

    assert.equal(status?.state, "running");
    assert.match(status?.contributionProblems?.[0] ?? "", /"Board Panel" must match/);

    // Причина обязана уехать тем же событием: для пользователя это единственный признак, что вклад
    // не появился, а журнал в браузер не отдаётся (docs/logging.md).
    assert.deepEqual(lifecycleEvents(recorded.events, "data:problem").at(-1), status);
  });

  it("forgets the rejected contribution when the plugin is switched off", async () => {
    const recorded = journal();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
    });
    running = supervisor;

    await supervisor.apply(only("problem"), enabled("data:problem"));
    await recorded.waitFor(reachedState("data:problem", "running"), "problem running");
    await supervisor.apply(only("problem"), disabled("data:problem"));

    const status = supervisor.statuses().find((entry) => entry.key === "data:problem");

    assert.equal(status?.state, "disabled");
    assert.equal(status?.contributionProblems, undefined);
  });

  it("takes the contributions away when the plugin is switched off", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    await supervisor.apply(only("hello"), disabled("data:hello"));

    assert.deepEqual(registry.resolved(), []);
  });

  it("switches a single contribution off without touching the plugin", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    await supervisor.apply(
      only("hello"),
      preferences({ "data:hello": { enabled: true, disabledContributions: ["hello.board"] } }),
    );

    assert.deepEqual(registry.resolved(), []);
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:hello")?.state,
      "running",
    );
  });

  it("shows the install stage and starts the plugin after it", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      ensureDependencies: async (_plugin, onInstallStart) => {
        onInstallStart();

        return { kind: "installed" };
      },
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "installing"), "the install stage");
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");
  });

  it("leaves a plugin whose dependencies could not be installed failed, without retrying", async () => {
    const recorded = journal();
    const clock = manualClock();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      schedule: clock.schedule,
      now: clock.now,
      ensureDependencies: async (_plugin, onInstallStart) => {
        onInstallStart();

        return { kind: "failed", reason: "npm error code E404" };
      },
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    const failure = await recorded.waitFor(
      reachedState("data:hello", "failed"),
      "the install failure",
    );

    assert.equal(failure["reason"], "npm error code E404");
    assert.deepEqual(clock.delays(), []);
    assert.equal(
      recorded.records.some((record) => record.message === "hello is up"),
      false,
    );
  });

  it("does not install anything for a built-in plugin", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    let asked = false;
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      ensureDependencies: async () => {
        asked = true;

        return { kind: "not-needed" };
      },
    });
    running = supervisor;

    const builtin = only("hello").plugins.map((plugin) => ({
      ...plugin,
      key: "builtin:hello",
      source: "builtin" as const,
    }));

    await supervisor.apply({ plugins: builtin, refused: [] }, enabled("builtin:hello"));
    await recorded.waitFor(reachedState("builtin:hello", "running"), "the built-in plugin running");

    assert.equal(asked, false);
  });

  it("builds the browser bundle before it launches the worker", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("browsered"), enabled("data:browsered"));
    await recorded.waitFor(reachedState("data:browsered", "running"), "browsered running");

    const states = lifecycleEvents(recorded.events, "data:browsered").map((status) => status.state);

    assert.deepEqual(states, ["discovered", "building", "starting", "running"]);

    const [status] = supervisor.statuses().filter((entry) => entry.key === "data:browsered");
    const browser = status?.browser;

    assert.ok(browser !== undefined, "the running plugin reports its browser assets");
    assert.equal(browser.entry, `/plugin-assets/data%3Abrowsered/${browser.revision}/browser.js`);
    assert.equal(browser.styles, `/plugin-assets/data%3Abrowsered/${browser.revision}/browser.css`);

    // Сборка попала не только в статус: по адресу лежат байты, и это тот же модуль.
    const script = supervisor.browserAsset("data:browsered", browser.revision, "browser.js");

    assert.ok(script !== undefined);
    assert.match(Buffer.from(script).toString("utf8"), /__sovereignHostModules__/);
  });

  it("says nothing about building for a plugin without a browser entry point", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    const states = lifecycleEvents(recorded.events, "data:hello").map((status) => status.state);

    assert.equal(states.includes("building"), false);
    assert.equal(
      supervisor.statuses().some((entry) => entry.browser !== undefined),
      false,
    );
  });

  it("leaves a plugin whose browser sources do not build failed, without retrying", async () => {
    const recorded = journal();
    const clock = manualClock();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      now: clock.now,
      schedule: clock.schedule,
    });
    running = supervisor;

    await supervisor.apply(only("browser-broken"), enabled("data:browser-broken"));
    const failure = await recorded.waitFor(
      reachedState("data:browser-broken", "failed"),
      "the build failure",
    );

    assert.match(String(failure["reason"]), /Could not resolve "\.\/missing-panel\.tsx"/);
    assert.match(String(failure["reason"]), /src\/browser\.tsx:7:22/);
    // Повтор раз в минуту не починит опечатку в TSX: попытки не назначаются вовсе.
    assert.deepEqual(clock.delays(), []);
    // Воркер не поднимался: сборка идёт до него.
    assert.equal(
      recorded.records.some((record) => record.message === "browser-broken is up"),
      false,
    );
  });

  it("removes the old contributions when the replacement browser bundle fails to build", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    const worker = join(fixtures, "browsered", "src", "worker.ts");
    const browser = join(fixtures, "browsered", "src", "browser.tsx");
    const originalWorker = readFileSync(worker, "utf8");
    const originalBrowser = readFileSync(browser, "utf8");

    try {
      writeFileSync(
        worker,
        'import { contribute, type PluginModule } from "@sovereign/sdk";\n\nexport const activate: PluginModule["activate"] = async () => {\n  await contribute.custom({ id: "panel", title: "Panel" });\n};\n',
      );
      await supervisor.apply(only("browsered"), enabled("data:browsered"));
      await recorded.waitFor(reachedState("data:browsered", "running"), "browsered running");
      assert.deepEqual(
        registry.resolved().map((registration) => registration.id),
        ["browsered.panel"],
      );

      writeFileSync(browser, "export const broken = ;\n");
      await supervisor.reload([
        { directory: join(fixtures, "browsered"), fileResourcesChanged: false },
      ]);
      await recorded.waitFor(
        reachedState("data:browsered", "failed"),
        "the replacement build failure",
      );

      assert.deepEqual(registry.resolved(), []);
    } finally {
      writeFileSync(worker, originalWorker);
      writeFileSync(browser, originalBrowser);
    }
  });

  it("keeps the previous revision readable after a reload and forgets both when switched off", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("browsered"), enabled("data:browsered"));
    await recorded.waitFor(reachedState("data:browsered", "running"), "browsered running");

    const first = revisionOf(supervisor, "data:browsered");
    const styles = join(fixtures, "browsered", "src", "badge.module.css");
    const original = readFileSync(styles, "utf8");

    try {
      writeFileSync(styles, `${original}\n.reloaded {\n  opacity: 1;\n}\n`);
      await supervisor.reload([
        { directory: join(fixtures, "browsered"), fileResourcesChanged: false },
      ]);
      await recorded.waitFor(
        (record) =>
          recorded.records.filter(reachedState("data:browsered", "running")).length === 2 &&
          record.message === "plugin lifecycle",
        "browsered running again",
      );
    } finally {
      writeFileSync(styles, original);
    }

    const second = revisionOf(supervisor, "data:browsered");

    assert.notEqual(first, second);
    // Страница, открытая до перезагрузки, ещё живёт на прежней ревизии.
    assert.notEqual(supervisor.browserAsset("data:browsered", first, "browser.js"), undefined);
    assert.notEqual(supervisor.browserAsset("data:browsered", second, "browser.js"), undefined);

    await supervisor.apply(only("browsered"), disabled("data:browsered"));

    assert.equal(supervisor.browserAsset("data:browsered", first, "browser.js"), undefined);
    assert.equal(supervisor.browserAsset("data:browsered", second, "browser.js"), undefined);
  });

  it("fails a plugin that throws in activate and retries with a growing delay", async () => {
    const recorded = journal();
    const clock = manualClock();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      now: clock.now,
      schedule: clock.schedule,
      retryDelaysMilliseconds: [10, 20, 40],
    });
    running = supervisor;

    await supervisor.apply(only("broken"), enabled("data:broken"));
    const first = await recorded.waitFor(
      reachedState("data:broken", "failed"),
      "the first failure",
    );

    assert.match(String(first["reason"]), /broken on purpose/);
    assert.equal(first["attempt"], 1);
    assert.deepEqual(clock.delays(), [10]);

    clock.fireAll();
    await recorded.waitFor(
      (record) => reachedState("data:broken", "failed")(record) && record["attempt"] === 2,
      "the second failure",
    );

    assert.deepEqual(clock.delays(), [20]);
  });

  it("counts a long-lived plugin's crash as the first one", async () => {
    const recorded = journal();
    const clock = manualClock();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      now: clock.now,
      schedule: clock.schedule,
      retryDelaysMilliseconds: [10, 20, 40],
      stabilityMilliseconds: 100,
    });
    running = supervisor;

    await supervisor.apply(only("broken"), enabled("data:broken"));
    await recorded.waitFor(reachedState("data:broken", "failed"), "the first failure");

    clock.advance(1_000);
    clock.fireAll();

    const second = await recorded.waitFor(
      (record) => reachedState("data:broken", "failed")(record) && record["attempt"] === 2,
      "the second failure",
    );

    // Плагин так и не поднялся, поэтому счётчик растёт: сброс полагается продержавшемуся, а не
    // пролежавшему в паузе.
    assert.equal(second["attempt"], 2);
  });

  it("deactivates a plugin the human switched off and forgets its contributions", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    await supervisor.apply(only("hello"), disabled("data:hello"));

    assert.equal(
      recorded.records.some((record) => record.message === "hello is going down"),
      true,
    );
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:hello")?.state,
      "disabled",
    );
  });

  it("does not let a hanging deactivate hold the unload", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      deactivateTimeoutMilliseconds: 50,
    });
    running = supervisor;

    await supervisor.apply(only("hanging"), enabled("data:hanging"));
    await recorded.waitFor(reachedState("data:hanging", "running"), "hanging running");

    await supervisor.apply(only("hanging"), disabled("data:hanging"));

    assert.equal(
      recorded.records.some(
        (record) => record.message === "the plugin did not deactivate in time and was terminated",
      ),
      true,
    );
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:hanging")?.state,
      "disabled",
    );
  });

  it("resolves stop() at once when the worker dies before it can deactivate", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    // Таймаут заведомо больше, чем занимает any реальный путь: если stop() его прождал — тест падает.
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      deactivateTimeoutMilliseconds: 2_000,
    });
    running = supervisor;

    await supervisor.apply(only("crashes-on-deactivate"), enabled("data:crashes-on-deactivate"));
    await recorded.waitFor(
      reachedState("data:crashes-on-deactivate", "running"),
      "crashes-on-deactivate running",
    );

    const started = Date.now();
    await supervisor.apply(only("crashes-on-deactivate"), disabled("data:crashes-on-deactivate"));
    const elapsed = Date.now() - started;

    // Воркер сам сделал exit(0); stop() должен резолвнуться от `exit`, а не от таймаута.
    assert.equal(
      recorded.records.some(
        (record) => record.message === "the plugin did not deactivate in time and was terminated",
      ),
      false,
    );
    assert.ok(elapsed < 2_000, `stop() took ${elapsed}ms, expected to beat the 2s timeout`);
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:crashes-on-deactivate")?.state,
      "disabled",
    );
  });

  it("does not stack message listeners on the worker across reloads", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    const warnings: string[] = [];
    const onWarning = (warning: Error): void => {
      warnings.push(warning.message);
    };
    process.on("warning", onWarning);

    try {
      // 12 циклов перебивают дефолт Node (10 listeners) — накопление даст MaxListenersExceededWarning.
      for (let i = 0; i < 12; i += 1) {
        await supervisor.apply(only("hello"), enabled("data:hello"));
        await recorded.waitFor(reachedState("data:hello", "running"), `hello running #${i + 1}`);
        await supervisor.apply(only("hello"), disabled("data:hello"));
        await recorded.waitFor(reachedState("data:hello", "disabled"), `hello disabled #${i + 1}`);
      }

      // Сбрасываем незавершённые обработчики warning, иначе сработают в следующем тесте.
      await wait(0);
      assert.equal(
        warnings.some((message) => message.includes("MaxListenersExceededWarning")),
        false,
        `unexpected listener warning: ${warnings.join(" | ")}`,
      );
    } finally {
      process.off("warning", onWarning);
    }
  });

  it("stops a plugin that disappeared from the disk", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    await supervisor.apply({ plugins: [], refused: [] }, enabled("data:hello"));

    assert.deepEqual(supervisor.statuses(), []);
  });

  it("reports a refused plugin without trying to run it", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(
      {
        plugins: [],
        refused: [
          {
            source: "data",
            directory: "/plugins/ahead",
            id: "ahead",
            reason: "the plugin requires platform ^9.0.0, this platform is 0.1.0",
            diagnostics: [],
          },
        ],
      },
      enabled("data:ahead"),
    );

    assert.deepEqual(supervisor.statuses(), [
      {
        key: "data:ahead",
        id: "ahead",
        source: "data",
        directory: "/plugins/ahead",
        state: "refused",
        reason: "the plugin requires platform ^9.0.0, this platform is 0.1.0",
      },
    ]);
  });

  it("reloads a plugin whose sources changed", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    const hello = only("hello").plugins[0];
    assert.ok(hello !== undefined);

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");
    const beforeReload = registry.revision();
    const beforeRouteGeneration = supervisor.routeGeneration();

    await supervisor.reload([{ directory: hello.directory, fileResourcesChanged: false }]);
    await recorded.waitFor(reachedState("data:hello", "stopped"), "hello stopped for the reload");
    await recorded.waitFor(
      (record) =>
        recorded.records.filter(reachedState("data:hello", "running")).length === 2 &&
        record.message === "plugin lifecycle",
      "hello running again",
    );

    assert.equal(
      recorded.records.filter((record) => record.message === "hello is going down").length,
      1,
    );
    assert.deepEqual(
      registry.resolved().map((registration) => registration.id),
      ["hello.board"],
    );
    assert.equal(registry.revision(), beforeReload);
    assert.equal(supervisor.routeGeneration(), beforeRouteGeneration + 1);
  });

  it("bumps the contribution revision once for a sibling file-resource change", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;
    const plugin = only("file-resources").plugins[0];
    assert.ok(plugin !== undefined);

    await supervisor.apply(only("file-resources"), enabled("data:file-resources"));
    await recorded.waitFor(reachedState("data:file-resources", "running"), "first activation");
    const beforeReload = registry.revision();

    await supervisor.reload([{ directory: plugin.directory, fileResourcesChanged: true }]);
    await recorded.waitFor(
      (record) =>
        recorded.records.filter(reachedState("data:file-resources", "running")).length === 2 &&
        record.message === "plugin lifecycle",
      "second activation",
    );

    assert.equal(registry.revision(), beforeReload + 1);
  });

  it("leaves a plugin nobody enabled alone when its sources change", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    const hello = only("hello").plugins[0];
    assert.ok(hello !== undefined);

    await supervisor.apply(only("hello"), disabled("data:hello"));
    await supervisor.reload([{ directory: hello.directory, fileResourcesChanged: false }]);

    assert.equal(
      recorded.records.some((record) => record.message === "hello is up"),
      false,
    );
  });

  it("stops every worker on shutdown", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
    });

    await supervisor.apply(only("hello", "typescripty"), enabled("data:hello", "data:typescripty"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");
    await recorded.waitFor(reachedState("data:typescripty", "running"), "typescripty running");

    await supervisor.stopAll();

    assert.deepEqual(
      supervisor.statuses().map((status) => status.state),
      ["stopped", "stopped"],
    );
  });
});

describe("a call from the core into a plugin", () => {
  const callable = async (recorded: Journal, clock?: ReturnType<typeof manualClock>) => {
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry: createContributionRegistry(),
      ...(clock === undefined ? {} : { schedule: clock.schedule, now: clock.now }),
    });
    running = supervisor;

    await supervisor.apply(only("callable"), enabled("data:callable"));
    await recorded.waitFor(reachedState("data:callable", "running"), "callable running");

    return supervisor;
  };

  it("brings back the value the tool of the plugin returned", async () => {
    const recorded = journal();
    const supervisor = await callable(recorded);

    assert.deepEqual(
      await supervisor.call(
        "data:callable",
        { kind: "tool", contributionId: "echo", arguments: { text: "ау" } },
        { timeoutMilliseconds: 5_000 },
      ),
      // Признак неудачи едет рядом с текстом: инструмент, сказавший «не вышло», не сбой плагина.
      { kind: "value", value: { content: "эхо: ау", isError: false } },
    );
  });

  it("carries the payload of the hook across the boundary of the worker", async () => {
    const recorded = journal();
    const supervisor = await callable(recorded);

    const answer = await supervisor.call(
      "data:callable",
      {
        kind: "hook",
        contributionId: "watch",
        event: "turn_finished",
        payload: {
          sessionId: "0199",
          projectId: "p1",
          usage: { inputTokens: 1, outputTokens: 2 },
        },
      },
      { timeoutMilliseconds: 5_000 },
    );

    assert.deepEqual(answer, { kind: "value", value: undefined });
    assert.equal(
      (
        await recorded.waitFor(
          (record) => record.message === "the turn finished",
          "the record of the handler",
        )
      )["session"],
      "0199",
    );
  });

  it("tells a refusal of a deciding hook from a value", async () => {
    const recorded = journal();
    const supervisor = await callable(recorded);
    const ask = (folder: string) =>
      supervisor.call(
        "data:callable",
        {
          kind: "hook",
          contributionId: "guard",
          event: "before_session_start",
          payload: { projectId: "p1", folder, agentId: "base" },
        },
        { timeoutMilliseconds: 5_000 },
      );

    assert.deepEqual(await ask("/forbidden"), { kind: "refused", reason: "эта папка закрыта" });

    // Разрешение — это отсутствие отказа, а не чей-то голос «за» (docs/hooks.md).
    assert.deepEqual(await ask("/allowed"), { kind: "value", value: undefined });
  });

  it("keeps an exception of the plugin inside the worker and answers a failure", async () => {
    const recorded = journal();
    const supervisor = await callable(recorded);

    // Исключение обработчика не имеет права дойти до Pi: там оно роняет турн (docs/hooks.md).
    const hook = await supervisor.call(
      "data:callable",
      {
        kind: "hook",
        contributionId: "throws",
        event: "before_session_start",
        payload: { projectId: "p1", folder: "/tmp", agentId: "base" },
      },
      { timeoutMilliseconds: 5_000 },
    );
    const tool = await supervisor.call(
      "data:callable",
      { kind: "tool", contributionId: "broken", arguments: {} },
      { timeoutMilliseconds: 5_000 },
    );

    assert.equal(hook.kind, "failed");
    assert.match(hook.kind === "failed" ? hook.reason : "", /the handler is broken/);
    assert.equal(tool.kind, "failed");
    assert.match(tool.kind === "failed" ? tool.reason : "", /the tool is broken/);
  });

  it("names a subscription the plugin never declared instead of hanging on it", async () => {
    const recorded = journal();
    const supervisor = await callable(recorded);

    const answer = await supervisor.call(
      "data:callable",
      { kind: "hook", contributionId: "never-declared", event: "turn_finished", payload: {} },
      { timeoutMilliseconds: 5_000 },
    );

    assert.equal(answer.kind, "failed");
    assert.match(
      answer.kind === "failed" ? answer.reason : "",
      /no handler for the hook subscription never-declared/,
    );
  });

  it("stops waiting for a handler that never answers, and says so with its author", async () => {
    const recorded = journal();
    const clock = manualClock();
    const supervisor = await callable(recorded, clock);

    const answer = supervisor.call(
      "data:callable",
      {
        kind: "hook",
        contributionId: "hangs",
        event: "before_session_start",
        payload: { projectId: "p1", folder: "/tmp", agentId: "base" },
      },
      { timeoutMilliseconds: 5_000 },
    );

    // Ожидание снимает демон: воркер с зависшим обработчиком о том, что он зависший, сообщить не
    // может по определению (docs/hooks.md).
    clock.fireAll();

    const outcome = await answer;

    // Таймаут отделён от сбоя: исход у них разный, и различать их по тексту причины значило бы
    // сверять формулировки вместо видов (docs/hooks.md).
    assert.deepEqual(outcome, { kind: "timed-out", waitedMilliseconds: 5_000 });

    // Таймаут не бывает молчаливым: вклад-автор назван в журнале (docs/hooks.md).
    const record = await recorded.waitFor(
      (candidate) => candidate.message === "the plugin did not answer a call in time",
      "the record of the timeout",
    );

    assert.equal(record["contribution"], "hangs");
    assert.equal(record["waitedMilliseconds"], 5_000);
  });

  it("answers the calls hanging on a plugin that is gone", async () => {
    const recorded = journal();
    const supervisor = await callable(recorded);

    const answer = supervisor.call(
      "data:callable",
      {
        kind: "hook",
        contributionId: "hangs",
        event: "before_session_start",
        payload: { projectId: "p1", folder: "/tmp", agentId: "base" },
      },
      // Заведомо больше, чем длится тест: проверяется выгрузка, а не таймаут.
      { timeoutMilliseconds: 600_000 },
    );

    await supervisor.apply(only("callable"), disabled("data:callable"));

    const outcome = await answer;

    assert.equal(outcome.kind, "failed");
    assert.match(outcome.kind === "failed" ? outcome.reason : "", /is gone and answers no calls/);
  });

  it("refuses to call a plugin that is not running", async () => {
    const recorded = journal();
    const supervisor = await callable(recorded);

    assert.deepEqual(
      await supervisor.call(
        "data:absent",
        { kind: "tool", contributionId: "echo", arguments: {} },
        { timeoutMilliseconds: 5_000 },
      ),
      {
        kind: "failed",
        reason: "the plugin data:absent is not running and answers no calls",
      },
    );
  });
});

describe("the subscriptions of a live plugin", () => {
  it("reconciles them when the contributions changed, not when the pass began", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const dispatcher = createHookDispatcher({
      logger: recorded.logger,
      bus: recorded.bus,
      timeoutMilliseconds: () => 5_000,
    });
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
      bus: recorded.bus,
      createPluginLogger: recorded.pluginLogger,
      registry,
      // Тот же сигнал, которым область плагинов сообщает об изменившемся наборе вкладов: подписки
      // сверяются по нему, а не по концу обхода (docs/hooks.md).
      publishContributionChanges: () => hooks.sync(),
    });
    const hooks = createPluginHooks({
      registry,
      plugins: supervisor,
      dispatcher,
      timeoutMilliseconds: () => 5_000,
    });

    running = supervisor;

    // Вклады попадают в реестр между `activate` и `running`, то есть позже, чем возвращается
    // применение: сверка, привязанная к его концу, не увидела бы ни одной подписки.
    await supervisor.apply(only("callable"), enabled("data:callable"));
    await recorded.waitFor(reachedState("data:callable", "running"), "callable running");

    assert.equal(dispatcher.subscribed("before_session_start", { projectId: "p1" }), true);
    assert.equal(dispatcher.subscribed("turn_finished", { projectId: "p1" }), true);

    // Ответ доезжает из воркера, а отказ несёт автора-вклада, а не автора-плагина. Спрашивается
    // подписка поимённо: на этом событии у фикстуры есть и зависший подписчик, которого ждать
    // пришлось бы весь таймаут.
    assert.deepEqual(
      await dispatcher.rewrite("turn_finished", { folder: "/forbidden" }, { projectId: "p1" }),
      { payload: { folder: "/forbidden" }, patch: undefined },
    );

    // Выключение вклада человеком снимает подписку: реестр перестаёт её отдавать, и сверка это видит.
    await supervisor.apply(
      only("callable"),
      preferences({
        "data:callable": { enabled: true, disabledContributions: ["callable.watch"] },
      }),
    );

    assert.equal(dispatcher.subscribed("turn_finished", { projectId: "p1" }), false);
  });
});
