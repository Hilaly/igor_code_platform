/**
 * Супервизор плагинов (ADR-0011): по одному воркеру на плагин, падение плагина не трогает ядро,
 * загрузочная и рабочая ошибка обрабатываются одинаково.
 *
 * Здесь же ведётся жизненный цикл (ADR-0018) и его наблюдаемость: каждый переход уходит и в
 * журнал, и в шину. Сами состояния — контракт и живут в протоколе; супервизор ими только
 * распоряжается.
 */

import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type { PluginContribution } from "@sovereign/sdk";
import {
  coreEventTypes,
  type LogSource,
  type PluginLifecycleState,
  type PluginStatus,
  type Preferences,
} from "@sovereign/protocol";

import type { ContributionRegistry } from "./contribution-registry.ts";
import type { EventBus } from "./event-bus.ts";
import type { Logger } from "./logger.ts";
import { ensurePluginDependencies, type DependencyOutcome } from "./plugin-dependencies.ts";
import { resolvePluginEnablement } from "./plugin-enablement.ts";
import { createPluginEvents } from "./plugin-events.ts";
import type { DiscoveredPlugin, PluginDiscovery } from "./plugin-sources.ts";
import type { PluginIncoming, PluginOutgoing, PluginWorkerData } from "./plugin-wire.ts";

export type PluginSupervisor = {
  statuses: () => PluginStatus[];
  /** Привести живое к желаемому: поднять включённые, погасить выключенные, забыть исчезнувшие. */
  apply: (discovery: PluginDiscovery, preferences: Preferences) => Promise<void>;
  /** Поднять заново включённые плагины из перечисленных папок: их исходники изменились. */
  reload: (directories: Iterable<string>) => Promise<void>;
  stopAll: () => Promise<void>;
};

/** Отмена запланированного действия. Возвращается планировщиком, чтобы таймер можно было снять. */
export type CancelScheduled = () => void;

export type CreatePluginSupervisorOptions = {
  logger: Logger;
  registry: ContributionRegistry;
  /** Куда уходят переходы жизненного цикла и смена набора вкладов (ADR-0018). */
  bus: EventBus;
  /** Источник записи штампует ядро: плагин не может назваться чужим именем (ADR-0074). */
  createPluginLogger: (source: LogSource) => Logger;
  now?: () => number;
  schedule?: (callback: () => void, delayMilliseconds: number) => CancelScheduled;
  /** Задержки перезапуска по номеру попытки; последняя — потолок (ADR-0011). */
  retryDelaysMilliseconds?: number[];
  deactivateTimeoutMilliseconds?: number;
  /** Сколько плагин должен продержаться, чтобы следующее падение считалось первым. */
  stabilityMilliseconds?: number;
  /** Установка зависимостей (ADR-0042). Внедряется, чтобы тест не ходил в сеть. */
  ensureDependencies?: (
    plugin: DiscoveredPlugin,
    onInstallStart: () => void,
  ) => Promise<DependencyOutcome>;
};

const defaultRetryDelays = [1_000, 5_000, 15_000, 30_000, 60_000];
const defaultDeactivateTimeout = 2_000;
const defaultStability = 60_000;

const bootstrapPath = join(import.meta.dirname, "plugin-worker.ts");

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

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
  pending: PluginContribution[];
  /** Последний применённый снимок: он переприменяется, когда человек переключил вклад. */
  contributed: PluginContribution[];
  /** Почему объявленный вклад не появился (ADR-0054): причина живёт до следующего применения. */
  contributionProblems: string[];
  disabledContributions: ReadonlySet<string>;
  /** Последнее применённое решение о включении: перезагрузка не имеет права поднять выключенный. */
  enabled: boolean;
  cancelRetry?: CancelScheduled;
  /** Метка текущей попытки старта: установка асинхронна, и её результат мог устареть. */
  startToken?: object;
};

export function createPluginSupervisor(options: CreatePluginSupervisorOptions): PluginSupervisor {
  const { logger, createPluginLogger, registry, bus } = options;
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
  const ensureDependencies =
    options.ensureDependencies ??
    ((plugin: DiscoveredPlugin, onInstallStart: () => void) =>
      ensurePluginDependencies({ directory: plugin.directory, logger, onInstallStart }));

  const supervised = new Map<string, Supervised>();
  const refused = new Map<string, PluginStatus>();

  const events = createPluginEvents({
    registry,
    bus,
    logger,
    // Воркера может уже не быть: плагин выгружается между публикацией и доставкой, и это штатно.
    send: (pluginKey, message) => supervised.get(pluginKey)?.worker?.postMessage(message),
  });

  /**
   * Единственное место, где состояние записи превращается в статус: снимок и событие обязаны
   * говорить одно и то же, иначе догон по потоку бессмысленен (ADR-0041).
   */
  const statusOf = (entry: Supervised): PluginStatus => ({
    key: entry.plugin.key,
    id: entry.plugin.id,
    source: entry.plugin.source,
    directory: entry.plugin.directory,
    state: entry.state,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.attempt === 0 ? {} : { attempt: entry.attempt }),
    ...(entry.nextAttemptAt === undefined ? {} : { nextAttemptAt: entry.nextAttemptAt }),
    ...(entry.contributionProblems.length === 0
      ? {}
      : { contributionProblems: entry.contributionProblems }),
  });

  const transition = (entry: Supervised, state: PluginLifecycleState, reason?: string): void => {
    entry.state = state;
    entry.reason = reason;

    const status = statusOf(entry);

    logger.info("plugin lifecycle", {
      plugin: status.key,
      state,
      ...(status.reason === undefined ? {} : { reason: status.reason }),
      ...(status.attempt === undefined ? {} : { attempt: status.attempt }),
      ...(status.nextAttemptAt === undefined ? {} : { nextAttemptAt: status.nextAttemptAt }),
    });

    bus.publish(coreEventTypes.pluginLifecycle, status);
  };

  /**
   * Ревизия реестра растёт только при настоящем изменении набора, поэтому она же и решает, есть ли
   * о чём сообщать: переприменение того же снимка никого не будит.
   */
  let publishedRevision = registry.revision();

  const publishContributions = (): void => {
    const revision = registry.revision();

    if (revision === publishedRevision) {
      return;
    }

    publishedRevision = revision;
    bus.publish(coreEventTypes.pluginContributions, {
      revision,
      contributions: registry.resolved(),
    });
  };

  /** Единственное место, где вклады плагина попадают в реестр: снимком, между activate и running. */
  const applyContributions = (entry: Supervised): void => {
    const outcome = registry.apply(entry.plugin, entry.contributed, entry.disabledContributions);

    // Причина уезжает в статус, то есть и в снимок, и в событие жизненного цикла: вклады
    // применяются перед переходом в `running`, поэтому событие уносит её с собой. Переключение
    // вклада набор проблем не меняет — они про форму объявления, а не про решение человека.
    entry.contributionProblems = outcome.problems;

    for (const problem of outcome.problems) {
      // Кривой вклад — событие жизненного цикла плагина, а не исключение (ADR-0054).
      logger.warn("the plugin contribution was not applied", {
        plugin: entry.plugin.key,
        reason: problem,
      });
    }

    // Действующий набор виден только здесь: вью плагинов ещё нет, а знать, что применилось, надо.
    logger.debug("plugin contributions applied", {
      plugin: entry.plugin.key,
      contributions: outcome.registered.map((registration) => registration.id),
      revision: registry.revision(),
    });

    for (const conflict of registry.conflicts()) {
      logger.warn(
        "the contribution is claimed by several plugins of one source and applies to none",
        {
          contribution: conflict.id,
          source: conflict.source,
          plugins: conflict.plugins,
        },
      );
    }

    publishContributions();
  };

  const dropContributions = (entry: Supervised): void => {
    entry.pending = [];
    entry.contributed = [];
    // Причина уходит вместе с вкладами: у выгруженного плагина объявленного нет вовсе.
    entry.contributionProblems = [];
    registry.remove(entry.plugin.key);

    // Подписки снимаются здесь же, где вклады: перезагруженный плагин подпишется заново, и две
    // подписки на одно имя означали бы двойную доставку.
    events.remove(entry.plugin.key);
    publishContributions();
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
      case "publish":
        events.publish(entry.plugin, message.declaredId, message.payload);

        return;
      case "subscribe":
        events.subscribe(entry.plugin, message.type);

        return;
      case "unsubscribe":
        events.unsubscribe(entry.plugin.key, message.type);

        return;
      case "activated":
        entry.contributed = entry.pending;
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

  /**
   * Установка — этап жизненного цикла, а не скрытая подготовка (ADR-0042): плагин с зависимостями
   * стартует долго, и это видно. Встроенные сюда не заходят — их зависимости решены сборкой.
   */
  const install = async (entry: Supervised): Promise<boolean> => {
    if (entry.plugin.source === "builtin") {
      return true;
    }

    const outcome = await ensureDependencies(entry.plugin, () => transition(entry, "installing"));

    if (outcome.kind === "failed") {
      // Провал установки не перезапускается (ADR-0070): повтор раз в минуту не починит сеть или
      // реестр. Повтор происходит по действию человека или по правке плагина.
      entry.attempt = 0;
      entry.nextAttemptAt = undefined;
      transition(entry, "failed", outcome.reason);

      return false;
    }

    logger.debug("the plugin dependencies are ready", {
      plugin: entry.plugin.key,
      outcome: outcome.kind,
    });

    return true;
  };

  const start = (entry: Supervised): void => {
    const token = {};
    entry.startToken = token;

    void (async () => {
      const ready = await install(entry);

      // Пока ставились зависимости, плагин могли выключить или снять с диска.
      if (ready && entry.startToken === token) {
        launch(entry);
      }
    })();
  };

  const launch = (entry: Supervised): void => {
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
    entry.startToken = undefined;

    const worker = entry.worker;

    // Даже без воркера переход пишется в журнал: «выключен» — такое же наблюдаемое состояние, как
    // «запущен», и человек, выключивший плагин, должен увидеть подтверждение (ADR-0018).
    if (worker === undefined) {
      dropContributions(entry);
      transition(entry, finalState);

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

      const status: PluginStatus = {
        key: plugin.id === undefined ? key : `${plugin.source}:${plugin.id}`,
        ...(plugin.id === undefined ? {} : { id: plugin.id }),
        source: plugin.source,
        directory: plugin.directory,
        state: "refused",
        reason: plugin.reason,
      };

      refused.set(key, status);

      // Отказ — такое же состояние жизненного цикла, как остальные, и публикуется наравне с ними:
      // иначе снимок знал бы о плагине то, чего не знает поток.
      bus.publish(coreEventTypes.pluginLifecycle, status);

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
          contributed: [],
          contributionProblems: [],
          disabledContributions: new Set(),
          enabled: false,
        };

        supervised.set(plugin.key, entry);
        transition(entry, "discovered");

        for (const diagnostic of plugin.diagnostics) {
          logger.warn(diagnostic, { plugin: plugin.key });
        }
      }

      entry.plugin = plugin;

      const switched = !sameSet(entry.disabledContributions, enablement.disabledContributions);
      entry.disabledContributions = enablement.disabledContributions;
      entry.enabled = enablement.enabled;

      const alive =
        entry.state === "installing" ||
        entry.state === "starting" ||
        entry.state === "running" ||
        entry.state === "failed";

      if (enablement.enabled && !alive) {
        entry.attempt = 0;
        start(entry);
        continue;
      }

      if (!enablement.enabled && entry.state !== "disabled") {
        await stop(entry, "disabled");
        continue;
      }

      // Переключение вклада не трогает плагин: он остаётся запущенным, меняется только набор
      // действующих вкладов (ADR-0032, ADR-0063).
      if (switched && entry.state === "running") {
        applyContributions(entry);
      }
    }
  };

  return {
    statuses: () => [...[...supervised.values()].map(statusOf), ...refused.values()],
    apply,
    reload: async (directories) => {
      const affected = new Set(directories);

      for (const entry of supervised.values()) {
        // Плагин, которому сейчас ставят зависимости, перезагружать нечего: он и так поднимется с
        // новыми исходниками, а перезапуск начал бы установку заново (ADR-0042).
        if (
          !affected.has(entry.plugin.directory) ||
          !entry.enabled ||
          entry.state === "installing"
        ) {
          continue;
        }

        logger.info("the plugin sources changed, reloading", { plugin: entry.plugin.key });

        await stop(entry, "stopped");
        entry.attempt = 0;
        start(entry);
      }
    },
    stopAll: async () => {
      for (const entry of supervised.values()) {
        // Уже выключенный или отказанный не «останавливается»: останавливать нечего.
        if (entry.state !== "disabled" && entry.state !== "stopped") {
          await stop(entry, "stopped");
        }
      }
    },
  };
}
