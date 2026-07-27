import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { LogRecord, LogSource, Preferences } from "@sovereign/protocol";

import { createContributionRegistry } from "./contribution-registry.ts";
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

const enabled = (...keys: string[]): Preferences => ({
  plugins: Object.fromEntries(
    keys.map((key) => [key, { enabled: true, disabledContributions: [] }]),
  ),
});

const disabled = (...keys: string[]): Preferences => ({
  plugins: Object.fromEntries(
    keys.map((key) => [key, { enabled: false, disabledContributions: [] }]),
  ),
});

type Journal = {
  records: LogRecord[];
  logger: Logger;
  pluginLogger: (source: LogSource) => Logger;
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

  return {
    records,
    logger: make("core"),
    pluginLogger: make,
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

describe("createPluginSupervisor", () => {
  it("starts an enabled plugin and stamps its log lines with its own source", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
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
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), { plugins: {} });

    // Не «обнаружен»: решение применено, и оно — «выключен» (ADR-0018).
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:hello")?.state,
      "disabled",
    );
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
      createPluginLogger: recorded.pluginLogger,
      registry,
    });
    running = supervisor;

    await supervisor.apply(only("hello"), enabled("data:hello"));
    await recorded.waitFor(reachedState("data:hello", "running"), "hello running");

    await supervisor.apply(only("hello"), {
      plugins: { "data:hello": { enabled: true, disabledContributions: ["hello.board"] } },
    });

    assert.deepEqual(registry.resolved(), []);
    assert.equal(
      supervisor.statuses().find((status) => status.key === "data:hello")?.state,
      "running",
    );
  });

  it("fails a plugin that throws in activate and retries with a growing delay", async () => {
    const recorded = journal();
    const clock = manualClock();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
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

  it("stops every worker on shutdown", async () => {
    const recorded = journal();
    const registry = createContributionRegistry();
    const supervisor = createPluginSupervisor({
      logger: recorded.logger,
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
