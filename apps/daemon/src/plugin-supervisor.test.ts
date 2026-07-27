import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { setTimeout as wait } from "node:timers/promises";

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
import { createEventBus, type EventBus } from "./event-bus.ts";
import { createLogger, type Logger } from "./logger.ts";
import {
  createPluginSupervisor,
  type CancelScheduled,
  type PluginSupervisor,
} from "./plugin-supervisor.ts";
import { discoverPlugins, type PluginDiscovery } from "./plugin-sources.ts";

const fixtures = join(import.meta.dirname, "plugin-fixtures");
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

let running: PluginSupervisor | undefined;

afterEach(async () => {
  await running?.stopAll();
  running = undefined;
});

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
    // делает догон бессмысленным (ADR-0041).
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

    await supervisor.reload([join(fixtures, "subscriber")]);
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

  it("says nothing about contributions when the effective set did not change", async () => {
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

    const before = recorded.events.filter(
      (event) => event.type === "core.plugin.contributions",
    ).length;

    // Тот же набор предпочтений: плагин остаётся запущенным, реестр не трогается.
    await supervisor.apply(only("hello"), enabled("data:hello"));

    assert.equal(
      recorded.events.filter((event) => event.type === "core.plugin.contributions").length,
      before,
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

    // Не «обнаружен»: решение применено, и оно — «выключен» (ADR-0018). Переход виден в журнале
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

    await supervisor.reload([hello.directory]);
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
    await supervisor.reload([hello.directory]);

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
