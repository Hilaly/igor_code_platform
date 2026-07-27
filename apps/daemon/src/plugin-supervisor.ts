/**
 * Супервизор плагинов (ADR-0011): по одному воркеру на плагин, падение плагина не трогает ядро,
 * загрузочная и рабочая ошибка обрабатываются одинаково.
 *
 * Здесь же живёт жизненный цикл (ADR-0018) и его наблюдаемость. Шины пока нет, поэтому переходы
 * уходят в журнал; когда шина появится, публикация встанет рядом с этим же местом.
 */

import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type { CustomContribution } from "@sovereign/sdk";
import type { LogSource, Preferences } from "@sovereign/protocol";

import type { Logger } from "./logger.ts";
import { resolvePluginEnablement } from "./plugin-enablement.ts";
import type { DiscoveredPlugin, PluginDiscovery } from "./plugin-sources.ts";
import type { PluginIncoming, PluginOutgoing, PluginWorkerData } from "./plugin-wire.ts";

/** Перечень — публичный контракт (ADR-0070): журнал, вью и будущая шина называют состояния так. */
export const pluginLifecycleStates = [
  "discovered",
  "disabled",
  "refused",
  "installing",
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
] as const;

export type PluginLifecycleState = (typeof pluginLifecycleStates)[number];

export type PluginStatus = {
  key: string;
  id?: string;
  source: string;
  directory: string;
  state: PluginLifecycleState;
  /** Почему отказано или почему упал. У штатных состояний причины нет. */
  reason?: string;
  /** Номер неудачной попытки и момент следующей: перезапуск наблюдаем, а не угадывается. */
  attempt?: number;
  nextAttemptAt?: number;
};

export type PluginSupervisor = {
  statuses: () => PluginStatus[];
  /** Привести живое к желаемому: поднять включённые, погасить выключенные, забыть исчезнувшие. */
  apply: (discovery: PluginDiscovery, preferences: Preferences) => Promise<void>;
  stopAll: () => Promise<void>;
};

/** Отмена запланированного действия. Возвращается планировщиком, чтобы таймер можно было снять. */
export type CancelScheduled = () => void;

export type CreatePluginSupervisorOptions = {
  logger: Logger;
  /** Источник записи штампует ядро: плагин не может назваться чужим именем (ADR-0021). */
  createPluginLogger: (source: LogSource) => Logger;
  now?: () => number;
  schedule?: (callback: () => void, delayMilliseconds: number) => CancelScheduled;
  /** Задержки перезапуска по номеру попытки; последняя — потолок (ADR-0011). */
  retryDelaysMilliseconds?: number[];
  deactivateTimeoutMilliseconds?: number;
  /** Сколько плагин должен продержаться, чтобы следующее падение считалось первым. */
  stabilityMilliseconds?: number;
};

const defaultRetryDelays = [1_000, 5_000, 15_000, 30_000, 60_000];
const defaultDeactivateTimeout = 2_000;
const defaultStability = 60_000;

const bootstrapPath = join(import.meta.dirname, "plugin-worker.ts");

type Supervised = {
  plugin: DiscoveredPlugin;
  logger: Logger;
  state: PluginLifecycleState;
  reason?: string;
  attempt: number;
  nextAttemptAt?: number;
  worker?: Worker;
  runningSince?: number;
  /** Вклады копятся до `activated` и применяются одним снимком (ADR-0024). */
  pending: CustomContribution[];
  cancelRetry?: CancelScheduled;
};

export function createPluginSupervisor(options: CreatePluginSupervisorOptions): PluginSupervisor {
  const { logger, createPluginLogger } = options;
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ??
    ((callback, delayMilliseconds) => {
      const timer = setTimeout(callback, delayMilliseconds);

      return () => clearTimeout(timer);
    });
  const retryDelays = options.retryDelaysMilliseconds ?? defaultRetryDelays;
  const deactivateTimeout = options.deactivateTimeoutMilliseconds ?? defaultDeactivateTimeout;
  const stability = options.stabilityMilliseconds ?? defaultStability;

  const supervised = new Map<string, Supervised>();
  const refused = new Map<string, PluginStatus>();

  const transition = (entry: Supervised, state: PluginLifecycleState, reason?: string): void => {
    entry.state = state;
    entry.reason = reason;

    logger.info("plugin lifecycle", {
      plugin: entry.plugin.key,
      state,
      ...(reason === undefined ? {} : { reason }),
      ...(entry.attempt === 0 ? {} : { attempt: entry.attempt }),
      ...(entry.nextAttemptAt === undefined ? {} : { nextAttemptAt: entry.nextAttemptAt }),
    });
  };

  const applyContributions = (entry: Supervised): void => {
    // Реестра вкладов ещё нет: снимок пока только виден в журнале. Место его применения одно,
    // и оно здесь — между `activated` и переходом в `running`.
    if (entry.pending.length > 0) {
      logger.debug("plugin contributions received", {
        plugin: entry.plugin.key,
        contributions: entry.pending.map((contribution) => contribution.id),
      });
    }
  };

  const dropContributions = (entry: Supervised): void => {
    entry.pending = [];
  };

  const fail = (entry: Supervised, reason: string): void => {
    if (entry.state === "stopping" || entry.state === "stopped" || entry.state === "disabled") {
      return;
    }

    const worker = entry.worker;
    entry.worker = undefined;
    void worker?.terminate();
    dropContributions(entry);

    // Плагин, продержавшийся достаточно долго, падает как в первый раз: иначе редкая ошибка раз в
    // сутки навсегда оставит его на потолке задержки.
    const held = entry.runningSince !== undefined && now() - entry.runningSince >= stability;

    entry.attempt = held ? 1 : entry.attempt + 1;
    entry.runningSince = undefined;

    const delay = retryDelays[Math.min(entry.attempt - 1, retryDelays.length - 1)] ?? 0;
    entry.nextAttemptAt = now() + delay;

    transition(entry, "failed", reason);

    entry.cancelRetry = schedule(() => {
      entry.cancelRetry = undefined;
      entry.nextAttemptAt = undefined;

      if (entry.state === "failed") {
        start(entry);
      }
    }, delay);
  };

  const handle = (entry: Supervised, message: PluginOutgoing): void => {
    switch (message.kind) {
      case "log":
        entry.logger[message.level](message.message, message.fields);

        return;
      case "contribute":
        entry.pending.push(message.contribution);

        return;
      case "activated":
        applyContributions(entry);
        entry.runningSince = now();
        entry.nextAttemptAt = undefined;
        transition(entry, "running");

        return;
      case "deactivated":
        if (message.problem !== undefined) {
          logger.warn("the plugin deactivate call failed", {
            plugin: entry.plugin.key,
            reason: message.problem,
          });
        }

        return;
      case "failed":
        fail(entry, message.reason);

        return;
    }
  };

  const start = (entry: Supervised): void => {
    transition(entry, "starting");

    const workerData: PluginWorkerData = {
      id: entry.plugin.id,
      source: entry.plugin.source,
      directory: entry.plugin.directory,
      workerEntry: entry.plugin.workerEntry,
    };

    const worker = new Worker(bootstrapPath, {
      workerData,
      // Флаг живёт только здесь: платформа исполняется без него (ADR-0004, проверка 4).
      // Предупреждение о его экспериментальности гасится — оно печаталось бы на каждый старт
      // каждого плагина и говорило бы то, что уже записано в решении.
      execArgv: ["--experimental-transform-types", "--no-warnings=ExperimentalWarning"],
    });

    entry.worker = worker;
    entry.pending = [];

    worker.on("message", (message: PluginOutgoing) => handle(entry, message));
    worker.on("error", (cause: Error) => fail(entry, cause.stack ?? cause.message));
    worker.on("exit", (code) => {
      if (entry.worker === worker) {
        entry.worker = undefined;
        fail(entry, `the worker exited with code ${code}`);
      }
    });
  };

  const stop = async (entry: Supervised, finalState: PluginLifecycleState): Promise<void> => {
    entry.cancelRetry?.();
    entry.cancelRetry = undefined;
    entry.nextAttemptAt = undefined;

    const worker = entry.worker;

    if (worker === undefined) {
      entry.state = finalState;
      dropContributions(entry);

      return;
    }

    transition(entry, "stopping");
    entry.worker = undefined;

    // Выгрузка ждёт `deactivate`, но не бесконечно: зависший плагин не имеет права держать
    // остановку демона (проверка 16).
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (!settled) {
          settled = true;
          cancel();
          resolve();
        }
      };

      const cancel = schedule(() => {
        logger.warn("the plugin did not deactivate in time and was terminated", {
          plugin: entry.plugin.key,
        });
        finish();
      }, deactivateTimeout);

      // Само сообщение разберёт слушатель, поставленный при запуске; здесь важен только факт.
      worker.on("message", (message: PluginOutgoing) => {
        if (message.kind === "deactivated") {
          finish();
        }
      });

      const request: PluginIncoming = { kind: "deactivate" };
      worker.postMessage(request);
    });

    await worker.terminate();

    dropContributions(entry);
    entry.runningSince = undefined;
    transition(entry, finalState);
  };

  const rememberRefusals = (discovery: PluginDiscovery): void => {
    const seen = new Set<string>();

    for (const plugin of discovery.refused) {
      const key = plugin.directory;
      seen.add(key);

      if (refused.get(key)?.reason === plugin.reason) {
        continue;
      }

      refused.set(key, {
        key: plugin.id === undefined ? key : `${plugin.source}:${plugin.id}`,
        ...(plugin.id === undefined ? {} : { id: plugin.id }),
        source: plugin.source,
        directory: plugin.directory,
        state: "refused",
        reason: plugin.reason,
      });

      logger.error("the plugin was refused", {
        plugin: plugin.id ?? plugin.directory,
        source: plugin.source,
        directory: plugin.directory,
        reason: plugin.reason,
      });
    }

    for (const key of [...refused.keys()]) {
      if (!seen.has(key)) {
        refused.delete(key);
      }
    }
  };

  const apply = async (discovery: PluginDiscovery, preferences: Preferences): Promise<void> => {
    rememberRefusals(discovery);

    const found = new Map(discovery.plugins.map((plugin) => [plugin.key, plugin]));

    // Плагин, исчезнувший с диска, гасится: живой воркер от удалённой папки — это призрак.
    for (const [key, entry] of supervised) {
      if (!found.has(key)) {
        await stop(entry, "stopped");
        supervised.delete(key);
      }
    }

    for (const plugin of discovery.plugins) {
      const enablement = resolvePluginEnablement(plugin, preferences);
      let entry = supervised.get(plugin.key);

      if (entry === undefined) {
        entry = {
          plugin,
          logger: createPluginLogger(`plugin:${plugin.id}`),
          state: "discovered",
          attempt: 0,
          pending: [],
        };

        supervised.set(plugin.key, entry);
        transition(entry, "discovered");

        for (const diagnostic of plugin.diagnostics) {
          logger.warn(diagnostic, { plugin: plugin.key });
        }
      }

      entry.plugin = plugin;

      const alive =
        entry.state === "starting" || entry.state === "running" || entry.state === "failed";

      if (enablement.enabled && !alive) {
        entry.attempt = 0;
        start(entry);
        continue;
      }

      if (!enablement.enabled && entry.state !== "disabled") {
        await stop(entry, "disabled");
      }
    }
  };

  return {
    statuses: () => [
      ...[...supervised.values()].map((entry) => ({
        key: entry.plugin.key,
        id: entry.plugin.id,
        source: entry.plugin.source,
        directory: entry.plugin.directory,
        state: entry.state,
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        ...(entry.attempt === 0 ? {} : { attempt: entry.attempt }),
        ...(entry.nextAttemptAt === undefined ? {} : { nextAttemptAt: entry.nextAttemptAt }),
      })),
      ...refused.values(),
    ],
    apply,
    stopAll: async () => {
      for (const entry of supervised.values()) {
        await stop(entry, "stopped");
      }
    },
  };
}
