/**
 * Супервизор плагинов (docs/plugins.md): по одному воркеру на плагин, падение плагина не трогает ядро,
 * загрузочная и рабочая ошибка обрабатываются одинаково.
 *
 * Здесь же ведётся жизненный цикл (docs/plugins.md) и его наблюдаемость: каждый переход уходит и в
 * журнал, и в шину. Сами состояния — контракт и живут в протоколе; супервизор ими только
 * распоряжается.
 */

import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type { LoginStep, PluginContribution } from "@sovereign/sdk";
import {
  coreEventTypes,
  pluginAssetAddress,
  pluginBrowserFileNames,
  type ContributionRegistration,
  type LogSource,
  type PluginBrowserAssets,
  type PluginLifecycleState,
  type PluginStatus,
  type Preferences,
} from "@sovereign/protocol";

import type {
  ContributingPlugin,
  ContributionRegistry,
  FileContributionInput,
} from "./contribution-registry.ts";
import type { EventBus } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";
import { createPluginAssetStore } from "./plugin-assets.ts";
import {
  buildPluginBrowser,
  stopPluginBrowserBuilds,
  type BrowserBuildOutcome,
  type PluginBrowserBundle,
} from "./plugin-browser-build.ts";
import { ensurePluginDependencies, type DependencyOutcome } from "./plugin-dependencies.ts";
import { resolvePluginEnablement } from "./plugin-enablement.ts";
import { createPluginEvents } from "./plugin-events.ts";
import {
  rediscoverPlugin,
  type DiscoveredPlugin,
  type DiscoveredPluginFileResources,
  type PluginDiscovery,
} from "./plugin-sources.ts";
import type { ChangedPluginDirectory } from "./plugin-watcher.ts";
import type {
  PluginCall,
  PluginCallResult,
  PluginIncoming,
  PluginLoginReply,
  PluginOutgoing,
  PluginRequest,
  PluginResponse,
  PluginWorkerData,
} from "./plugin-wire.ts";

export type PluginSupervisor = {
  statuses: () => PluginStatus[];
  /** Поколение HTTP-маршрутов: меняется сразу при перезагрузке, до остановки старого воркера. */
  routeGeneration: () => number;
  /** Есть ли сейчас воркер, которому можно передать HTTP-вызов. */
  isRunning: (pluginKey: string) => boolean;
  /**
   * Файл собранного браузерного бандла. Владеет им супервизор, потому что живёт бандл ровно столько
   * же, сколько плагин: выключили — забыли.
   */
  browserAsset: (pluginKey: string, revision: string, file: string) => Uint8Array | undefined;
  /** Привести живое к желаемому: поднять включённые, погасить выключенные, забыть исчезнувшие. */
  apply: (discovery: PluginDiscovery, preferences: Preferences) => Promise<void>;
  /** Поднять заново включённые плагины из перечисленных папок: их исходники изменились. */
  reload: (directories: Iterable<ChangedPluginDirectory>) => Promise<void>;
  /**
   * Позвать плагин и дождаться значения (docs/hooks.md). Таймаут задаёт вызывающий: у хука и у
   * инструмента свои ожидания и свои ключи `config.json`, а супервизор про них ничего не знает.
   *
   * Исключений не бросает: и мёртвый воркер, и таймаут, и упавший обработчик приезжают исходом.
   */
  call: (
    pluginKey: string,
    call: PluginCall,
    waiting: { timeoutMilliseconds: number },
  ) => Promise<PluginCallOutcome>;
  stopAll: () => Promise<void>;
};

/** Отмена запланированного действия. Возвращается планировщиком, чтобы таймер можно было снять. */
export type CancelScheduled = () => void;

/**
 * Чем кончился вызов плагина глазами ядра. К тому, что умеет сказать воркер, добавляется таймаут:
 * его ставит демон, и от сбоя он отличается исходом — сбой это ошибка в журнал, а таймаут
 * разбирается по таблице критичности подписки (docs/hooks.md).
 */
export type PluginCallOutcome =
  PluginCallResult | { kind: "timed-out"; waitedMilliseconds: number };

/**
 * Один запрос плагина глазами того, кто на него отвечает. Имя не `PluginCall`: вызовом называется
 * обратное направление, где зовёт ядро (`plugin-wire.ts`).
 */
export type PluginRequestContext = {
  /**
   * Идентификатор вызова. Им же ключуются шаги входа и ответы на них: шаг — часть контракта самой
   * операции, а не отдельный поток (docs/models-and-providers.md).
   */
  requestId: string;
  /** Шаг входа плагину: он приходит по ходу операции, а не в её ответе. */
  sendLoginStep: (step: LoginStep) => void;
};

export type CreatePluginSupervisorOptions = {
  logger: Logger;
  registry: ContributionRegistry;
  /** Куда уходят переходы жизненного цикла и смена набора вкладов (docs/plugins.md). */
  bus: EventBus;
  /** Общая инвалидация контекстных вкладов; дедупликация по revision живёт в composition root. */
  publishContributionChanges?: () => void;
  /** Источник записи штампует ядро: плагин не может назваться чужим именем (docs/logging.md). */
  createPluginLogger: (source: LogSource) => Logger;
  now?: () => number;
  schedule?: (callback: () => void, delayMilliseconds: number) => CancelScheduled;
  /** Задержки перезапуска по номеру попытки; последняя — потолок (docs/plugins.md). */
  retryDelaysMilliseconds?: number[];
  deactivateTimeoutMilliseconds?: number;
  /** Сколько плагин должен продержаться, чтобы следующее падение считалось первым. */
  stabilityMilliseconds?: number;
  /** Установка зависимостей (docs/plugins.md). Внедряется, чтобы тест не ходил в сеть. */
  ensureDependencies?: (
    plugin: DiscoveredPlugin,
    onInstallStart: () => void,
  ) => Promise<DependencyOutcome>;
  /**
   * Сборка браузерной части (docs/ui-extension-model.md). Внедряется по той же причине, что и
   * установка: тесту жизненного цикла нужен управляемый провал, а не настоящий esbuild.
   */
  buildBrowser?: (plugin: DiscoveredPlugin) => Promise<BrowserBuildOutcome>;
  /**
   * Ответить на запрос плагина о провайдерах (`plugin-providers.ts`). Необязателен: супервизор
   * поднимает плагины и без каталога — тесты жизненного цикла о провайдерах не знают вовсе.
   *
   * Супервизор здесь **только маршрутизирует**: он не знает ни о каталоге, ни о попытках входа.
   */
  onRequest?: (
    plugin: ContributingPlugin,
    request: PluginRequest,
    call: PluginRequestContext,
  ) => Promise<PluginResponse>;
  /** Ответ плагина на шаг входа или отказ отвечать. */
  onLoginReply?: (plugin: ContributingPlugin, reply: PluginLoginReply) => void;
  /**
   * Плагина больше нет: выгрузка, падение или перезагрузка. Зовётся там же, где снимаются вклады и
   * подписки, — мёртвый воркер не имеет права держать провайдера занятым
   * (docs/models-and-providers.md).
   */
  onPluginGone?: (pluginKey: string) => void;
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
  stoppingWorker?: Worker;
  runningSince?: number;
  /** Вклады копятся до `activated` и применяются одним снимком (docs/ui-extension-model.md). */
  pending: PluginContribution[];
  /** Последний применённый снимок: он переприменяется, когда человек переключил вклад. */
  contributed: PluginContribution[];
  /** Файловый снимок той же успешной активации; новый discovery не публикует его раньше времени. */
  fileResources: DiscoveredPluginFileResources;
  /** Почему объявленный вклад не появился (docs/plugins.md): причина живёт до следующего применения. */
  contributionProblems: string[];
  disabledContributions: ReadonlySet<string>;
  /** Последнее применённое решение о включении: перезагрузка не имеет права поднять выключенный. */
  enabled: boolean;
  resourceChanged: boolean;
  /**
   * Вызовы ядра, ждущие ответа этого воркера. Живут у записи, а не общей таблицей: смерть воркера
   * обязана ответить именно его вызовам, и никаким чужим.
   */
  awaitingCall: Map<string, (result: PluginCallOutcome) => void>;
  cancelRetry?: CancelScheduled;
  /** Метка текущей попытки старта: установка асинхронна, и её результат мог устареть. */
  startToken?: object;
  /** Адреса собранного браузерного кода этой попытки: у плагина без интерфейса их нет. */
  browser?: PluginBrowserAssets;
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
  const buildBrowser =
    options.buildBrowser ??
    ((plugin: DiscoveredPlugin) =>
      buildPluginBrowser({
        pluginKey: plugin.key,
        directory: plugin.directory,
        ...(plugin.manifest.browser === undefined ? {} : { browserEntry: plugin.manifest.browser }),
      }));
  const assets = createPluginAssetStore();

  const supervised = new Map<string, Supervised>();
  const refused = new Map<string, PluginStatus>();
  let routeGeneration = 0;

  const events = createPluginEvents({
    registry,
    bus,
    logger,
    // Воркера может уже не быть: плагин выгружается между публикацией и доставкой, и это штатно.
    send: (pluginKey, message) => supervised.get(pluginKey)?.worker?.postMessage(message),
  });

  /**
   * Единственное место, где состояние записи превращается в статус: снимок и событие обязаны
   * говорить одно и то же, иначе догон по потоку бессмысленен (docs/event-bus.md).
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
    ...(entry.browser === undefined ? {} : { browser: entry.browser }),
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

  /** Plugin-specific событие следует только за мутацией плагина; standalone меняет тот же реестр. */
  const publishContributions = (previousRevision: number): void => {
    const revision = registry.revision();

    if (revision === previousRevision) {
      return;
    }

    bus.publish(coreEventTypes.pluginContributions, {
      revision,
      contributions: registry.resolved(),
    });
    options.publishContributionChanges?.();
  };

  /** Единственное место, где вклады плагина попадают в реестр: снимком, между activate и running. */
  const applyContributions = (entry: Supervised): void => {
    const revision = registry.revision();
    const outcome = registry.applyPlugin(
      {
        plugin: entry.plugin,
        contributions: entry.contributed,
        fileContributions: fileContributions(entry.plugin, entry.fileResources),
        disabledContributions: entry.disabledContributions,
      },
      { resourceChanged: entry.resourceChanged },
    );
    entry.resourceChanged = false;

    // Причина уезжает в статус, то есть и в снимок, и в событие жизненного цикла: вклады
    // применяются перед переходом в `running`, поэтому событие уносит её с собой. Переключение
    // вклада набор проблем не меняет — они про форму объявления, а не про решение человека.
    entry.contributionProblems = [
      ...outcome.problems,
      ...entry.fileResources.invalid.flatMap((resource) =>
        resource.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`),
      ),
    ];

    for (const problem of entry.contributionProblems) {
      // Кривой вклад — событие жизненного цикла плагина, а не исключение (docs/plugins.md).
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

    publishContributions(revision);
  };

  /**
   * Ответить всем висящим вызовам этого плагина. Зовётся там же, где снимаются вклады: воркера
   * больше нет, и вызов иначе ждал бы своего таймаута у того, кого уже некому спросить.
   */
  const abandonCalls = (entry: Supervised, reason: string): void => {
    // Снимок значений: ожидание снимает сам `settle`, и обход живой таблицы шёл бы по тому, что она
    // на ходу теряет.
    for (const settle of [...entry.awaitingCall.values()]) {
      settle({ kind: "failed", reason });
    }
  };

  const dropContributions = (entry: Supervised, preserveSnapshot = false): void => {
    const revision = registry.revision();

    abandonCalls(entry, `the plugin ${entry.plugin.key} is gone and answers no calls`);
    entry.pending = [];
    entry.contributed = [];
    // Причина уходит вместе с вкладами: у выгруженного плагина объявленного нет вовсе.
    entry.contributionProblems = [];
    if (!preserveSnapshot) {
      registry.remove(entry.plugin.key);
    }

    // Подписки снимаются здесь же, где вклады: перезагруженный плагин подпишется заново, и две
    // подписки на одно имя означали бы двойную доставку.
    events.remove(entry.plugin.key);

    // По той же причине здесь снимается и всё, что плагин занял у провайдеров: воркера больше нет,
    // а идущий вход держал бы провайдера занятым до перезапуска демона.
    options.onPluginGone?.(entry.plugin.key);
    publishContributions(revision);
  };

  const fail = (entry: Supervised, reason: string): void => {
    if (entry.state === "stopping" || entry.state === "stopped" || entry.state === "disabled") {
      return;
    }

    const worker = entry.worker;
    entry.worker = undefined;
    void worker?.terminate();
    dropContributions(entry);

    // Ассеты остаются в памяти, а статус про них молчит: страница, открытая до падения, ещё вправе
    // дозапросить карту кода своей ревизии, но обещать браузерную часть упавшего плагина нельзя.
    entry.browser = undefined;

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

  /**
   * Ответить нечем, пока мост не подключён: молчание оставило бы плагин висеть на `await` навсегда.
   */
  const answerRequest =
    options.onRequest ??
    (async () =>
      ({ kind: "failed", reason: "this daemon answers no requests from plugins" }) as const);

  const handle = (entry: Supervised, worker: Worker, message: PluginOutgoing): void => {
    // Listener старого worker может получить уже поставленное в очередь сообщение после того, как
    // stop/reload обнулили текущий worker. Такое сообщение не принадлежит новой попытке lifecycle.
    const current =
      entry.worker === worker && (entry.state === "starting" || entry.state === "running");
    const stopping = entry.stoppingWorker === worker && entry.state === "stopping";

    // Выгружающийся воркер ещё вправе договорить: ответ на вызов, пришедший по ходу выгрузки, — это
    // ответ того самого воркера, которого спрашивали, и он лучше выдуманного сбоя.
    const stoppingMayStillSpeak =
      message.kind === "log" ||
      message.kind === "deactivated" ||
      message.kind === "call-result" ||
      message.kind === "request";

    if (!current && !(stopping && stoppingMayStillSpeak)) {
      return;
    }

    switch (message.kind) {
      case "log":
        entry.logger[message.level](message.message, message.fields);

        return;
      case "contribute":
        if (entry.state !== "starting") {
          return;
        }
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
      case "login-answer":
      case "login-cancel":
        options.onLoginReply?.(entry.plugin, message);

        return;
      case "call-result":
        // Ответ на вызов, которого уже нет, — штатное: его сняли по таймауту, и ответ разъехался с
        // ожиданием. Снимает ожидание сам `settle`, здесь его только зовут.
        entry.awaitingCall.get(message.callId)?.(message.result);

        return;
      case "request": {
        const requestId = message.requestId;
        const sendLoginStep = (step: LoginStep): void => {
          // Тот же вопрос, что и с ответом: воркер мог смениться, пока шёл диалог.
          if (entry.worker === worker || (entry.stoppingWorker === worker && stopping)) {
            const carried: PluginIncoming = { kind: "login-step", requestId, step };

            worker.postMessage(carried);
          }
        };

        void answerRequest(entry.plugin, message.request, { requestId, sendLoginStep })
          .catch(
            (cause: unknown) =>
              ({
                kind: "failed",
                reason: cause instanceof Error ? cause.message : String(cause),
              }) as const,
          )
          .then((response) => {
            // Воркер мог умереть, пока мост отвечал: отвечать в чужой воркер, поднятый на его
            // месте, нельзя — `requestId` уникален только внутри одного воркера.
            if (entry.worker === worker || (entry.stoppingWorker === worker && stopping)) {
              const answer: PluginIncoming = { kind: "response", requestId, response };

              worker.postMessage(answer);
            }
          });

        return;
      }
      case "activated":
        if (entry.state !== "starting") {
          return;
        }
        entry.contributed = entry.pending;
        entry.fileResources = entry.plugin.fileResources;
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
   * Установка — этап жизненного цикла, а не скрытая подготовка (docs/plugins.md): плагин с зависимостями
   * стартует долго, и это видно. Встроенные сюда не заходят — их зависимости решены сборкой.
   */
  const install = async (entry: Supervised): Promise<boolean> => {
    if (entry.plugin.source === "builtin") {
      return true;
    }

    const outcome = await ensureDependencies(entry.plugin, () => transition(entry, "installing"));

    if (outcome.kind === "failed") {
      // Провал установки не перезапускается (docs/plugins.md): повтор раз в минуту не починит сеть или
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

  /**
   * Сборка браузерной части — тоже этап жизненного цикла, а не скрытая подготовка: провалившаяся
   * сборка обязана быть видна человеку там же, где остальные причины «плагин не работает».
   *
   * Сборка идёт **до** подъёма воркера: вклады, которые воркер объявит в `activate`, ссылаются на
   * экспорты бандла, и без бандла реестр наполнился бы мёртвыми ссылками.
   */
  const build = async (entry: Supervised, token: object): Promise<boolean> => {
    if (entry.plugin.manifest.browser === undefined) {
      return true;
    }

    transition(entry, "building");

    const outcome = await buildBrowser(entry.plugin);

    // Пока шла сборка, плагин могли выключить, перезагрузить или снять с диска.
    if (entry.startToken !== token) {
      return false;
    }

    if (outcome.kind === "failed") {
      // Как и провал установки (docs/plugins.md): повтор раз в минуту не починит опечатку в TSX.
      // Повтор происходит по правке файла или по повторному включению.
      entry.attempt = 0;
      entry.nextAttemptAt = undefined;
      transition(entry, "failed", outcome.reason);

      return false;
    }

    if (outcome.kind === "built") {
      assets.put(entry.plugin.key, outcome.bundle);
      entry.browser = browserAssetsOf(entry.plugin.key, outcome.bundle);

      logger.debug("the plugin browser bundle is built", {
        plugin: entry.plugin.key,
        revision: outcome.bundle.revision,
      });
    }

    return true;
  };

  const start = (entry: Supervised): void => {
    const token = {};
    entry.startToken = token;

    void (async () => {
      const ready = await install(entry);

      // Пока ставились зависимости, плагин могли выключить или снять с диска.
      if (!ready || entry.startToken !== token) {
        return;
      }

      if (await build(entry, token)) {
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
      // Флаг живёт только здесь: платформа исполняется без него (docs/toolchain.md, проверка 4).
      // Предупреждение о его экспериментальности гасится — оно печаталось бы на каждый старт
      // каждого плагина и говорило бы то, что уже записано в решении.
      execArgv: ["--experimental-transform-types", "--no-warnings=ExperimentalWarning"],
    });

    entry.worker = worker;
    entry.pending = [];

    worker.on("message", (message: PluginOutgoing) => handle(entry, worker, message));
    worker.on("error", (cause: Error) => fail(entry, cause.stack ?? cause.message));
    worker.on("exit", (code) => {
      if (entry.worker === worker) {
        entry.worker = undefined;
        fail(entry, `the worker exited with code ${code}`);
      }
    });
  };

  const stop = async (
    entry: Supervised,
    finalState: PluginLifecycleState,
    preserveSnapshot = false,
  ): Promise<void> => {
    entry.cancelRetry?.();
    entry.cancelRetry = undefined;
    entry.nextAttemptAt = undefined;
    entry.startToken = undefined;

    const worker = entry.worker;

    // Перезагрузка ассеты не забывает: прежняя ревизия нужна странице, открытой до неё. Выключение
    // и остановка забывают — плагина больше нет, и держать его код в памяти незачем.
    if (!preserveSnapshot) {
      assets.forget(entry.plugin.key);
    }
    entry.browser = undefined;

    // Даже без воркера переход пишется в журнал: «выключен» — такое же наблюдаемое состояние, как
    // «запущен», и человек, выключивший плагин, должен увидеть подтверждение (docs/plugins.md).
    if (worker === undefined) {
      dropContributions(entry, preserveSnapshot);
      transition(entry, finalState);

      return;
    }

    transition(entry, "stopping");
    entry.worker = undefined;
    entry.stoppingWorker = worker;

    // Выгрузка ждёт `deactivate`, но не бесконечно: зависший плагин не имеет права держать
    // остановку демона (проверка 16).
    await new Promise<void>((resolve) => {
      let settled = false;

      const onDeactivated = (message: PluginOutgoing): void => {
        if (message.kind === "deactivated") {
          finish();
        }
      };

      // Воркер может умереть сам, не дождавшись `deactivate` (падение, OOM, сигнал). Пока
      // стоящий при запуске обработчик `exit` не резолвит `stop()` — он проверяет
      // `entry.worker === worker`, а здесь уже `undefined`, — и промис честно ждёт таймаут.
      // На stopAll, идущему последовательно, это складывается в `deactivateTimeout × N упавших`.
      const onExit = (): void => finish();

      const finish = (): void => {
        if (!settled) {
          settled = true;
          cancel();
          worker.off("message", onDeactivated);
          worker.off("exit", onExit);
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
      worker.on("message", onDeactivated);
      worker.on("exit", onExit);

      const request: PluginIncoming = { kind: "deactivate" };
      worker.postMessage(request);
    });

    await worker.terminate();
    entry.stoppingWorker = undefined;

    dropContributions(entry, preserveSnapshot);
    entry.runningSince = undefined;
    transition(entry, finalState);
  };

  /**
   * Счётчик вызовов **демонский** и общий для всех плагинов: воркерский `requestId` живёт в другом
   * направлении, и сопоставлять их нечем. Пара «ключ плагина + номер» уникальна и без сброса.
   */
  let callsSent = 0;

  const call = (
    pluginKey: string,
    request: PluginCall,
    waiting: { timeoutMilliseconds: number },
  ): Promise<PluginCallOutcome> => {
    const entry = supervised.get(pluginKey);
    const worker = entry?.worker;

    // Спрашивать выключенный, упавший или ещё запускающийся плагин нечем. Это исход, а не
    // исключение: зовущая сторона обязана уметь обойтись без вклада, которого нет.
    if (entry === undefined || worker === undefined || entry.state !== "running") {
      return Promise.resolve({
        kind: "failed",
        reason: `the plugin ${pluginKey} is not running and answers no calls`,
      });
    }

    callsSent += 1;
    const callId = String(callsSent);

    return new Promise<PluginCallOutcome>((resolve) => {
      // Ожидание заводится раньше таймера, а таймер отдаётся ожиданию через эту ячейку: планировщик
      // теста вправе позвать обратный вызов сразу, и тогда снимать будет ещё нечего.
      const timeout: { cancel?: CancelScheduled } = {};

      const settle = (result: PluginCallOutcome): void => {
        // Ответ и таймаут могли прийти оба: побеждает первый, и второй уже никого не касается.
        if (!entry.awaitingCall.delete(callId)) {
          return;
        }

        timeout.cancel?.();
        resolve(result);
      };

      entry.awaitingCall.set(callId, settle);

      timeout.cancel = schedule(() => {
        // Таймаут не бывает молчаливым (docs/hooks.md): автор вызова назван, и запись остаётся в
        // журнале даже если зовущая сторона решит вызов проигнорировать.
        logger.warn("the plugin did not answer a call in time", {
          plugin: pluginKey,
          contribution: request.contributionId,
          call: request.kind,
          waitedMilliseconds: waiting.timeoutMilliseconds,
        });
        settle({ kind: "timed-out", waitedMilliseconds: waiting.timeoutMilliseconds });
      }, waiting.timeoutMilliseconds);

      const carried: PluginIncoming = { kind: "call", callId, call: request };

      worker.postMessage(carried);
    });
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
          fileResources: plugin.fileResources,
          contributionProblems: [],
          disabledContributions: new Set(),
          enabled: false,
          resourceChanged: false,
          awaitingCall: new Map(),
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
        entry.state === "building" ||
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
      // действующих вкладов (docs/plugins.md).
      if (switched && entry.state === "running") {
        applyContributions(entry);
      }
    }
  };

  return {
    statuses: () => [...[...supervised.values()].map(statusOf), ...refused.values()],
    routeGeneration: () => routeGeneration,
    isRunning: (pluginKey) => {
      const entry = supervised.get(pluginKey);

      return entry?.worker !== undefined && entry.state === "running";
    },
    browserAsset: (pluginKey, revision, file) => assets.read(pluginKey, revision, file),
    apply,
    call,
    reload: async (directories) => {
      const affected = new Map(
        [...directories].map((changed) => [changed.directory, changed.fileResourcesChanged]),
      );

      for (const entry of supervised.values()) {
        // Плагин, которому сейчас ставят зависимости, перезагружать нечего: он и так поднимется с
        // новыми исходниками, а перезапуск начал бы установку заново (docs/plugins.md).
        if (
          !affected.has(entry.plugin.directory) ||
          !entry.enabled ||
          entry.state === "installing"
        ) {
          continue;
        }

        logger.info("the plugin sources changed, reloading", { plugin: entry.plugin.key });

        // HTTP keeps the old contribution snapshot while the replacement activates so other
        // consumers see an atomic switch. Routes need a separate generation, however: a request
        // whose body finishes during this gap must not be sent to a replacement worker.
        routeGeneration += 1;
        await stop(entry, "stopped", true);
        const refreshed = rediscoverPlugin(entry.plugin);
        if (refreshed === undefined) {
          const revision = registry.revision();
          registry.removePlugin(entry.plugin.key);
          publishContributions(revision);
          // Перезагрузка ассеты сохранила, но плагина не стало вовсе — держать их больше не для кого.
          assets.forget(entry.plugin.key);
          supervised.delete(entry.plugin.key);
          continue;
        }
        entry.plugin = refreshed;
        entry.resourceChanged = affected.get(entry.plugin.directory) === true;
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

      // Снимает подписку на шину, чтобы пересоздание супервизора (тест, будущий рантайм) не
      // оставляло старую доставлять события в дохлые хэндлы воркеров.
      events.close();

      // esbuild держит дочерний процесс-сервис: без этого демон не завершается (docs/toolchain.md).
      stopPluginBrowserBuilds();
    },
  };
}

/**
 * Адреса собранного бандла. Составляются здесь, а не в браузере: правило составления знает тот, кто
 * знает ревизию, и повторённое на другой стороне оно разъехалось бы при первой же правке.
 */
function browserAssetsOf(pluginKey: string, bundle: PluginBrowserBundle): PluginBrowserAssets {
  const styles = bundle.files.has(pluginBrowserFileNames.styles)
    ? pluginAssetAddress(pluginKey, bundle.revision, pluginBrowserFileNames.styles)
    : undefined;

  return {
    revision: bundle.revision,
    entry: pluginAssetAddress(pluginKey, bundle.revision, pluginBrowserFileNames.script),
    ...(styles === undefined ? {} : { styles }),
  };
}

function fileContributions(
  plugin: DiscoveredPlugin,
  fileResources: DiscoveredPluginFileResources,
): FileContributionInput[] {
  return [
    ...fileResources.definitions.map((definition): FileContributionInput => ({
      path: definition.entryPath,
      kind: definition.kind,
      diagnostics: definition.diagnostics,
      name: definition.name,
      description: definition.description,
      id: `${plugin.id}.${definition.name}`,
      registration: fileRegistration(plugin, definition),
    })),
    ...fileResources.invalid.map((resource): FileContributionInput => ({
      path: resource.entryPath,
      kind: resource.kind,
      diagnostics: resource.diagnostics,
    })),
  ];
}

function fileRegistration(
  plugin: DiscoveredPlugin,
  definition: DiscoveredPlugin["fileResources"]["definitions"][number],
): Extract<ContributionRegistration, { kind: "agent" | "skill" }> {
  const ownership = {
    ownership: "plugin" as const,
    pluginKey: plugin.key,
    pluginId: plugin.id,
    source: plugin.source,
  };
  const common = {
    ...ownership,
    id: `${plugin.id}.${definition.name}`,
    declaredId: definition.name,
    description: definition.description,
  };

  if (definition.kind === "agent") {
    return {
      ...common,
      kind: "agent",
      instructions: definition.instructions,
      tools: definition.tools,
      skills: definition.skills,
      ...(definition.model === undefined ? {} : { model: definition.model }),
      ...(definition.thinkingLevel === undefined
        ? {}
        : { thinkingLevel: definition.thinkingLevel }),
    };
  }

  return {
    ...common,
    kind: "skill",
    name: definition.name,
    location: definition.location,
    ...(definition.license === undefined ? {} : { license: definition.license }),
    ...(definition.compatibility === undefined ? {} : { compatibility: definition.compatibility }),
    ...(definition.metadata === undefined ? {} : { metadata: definition.metadata }),
    ...(definition.allowedTools === undefined ? {} : { allowedTools: definition.allowedTools }),
    disableModelInvocation: definition.disableModelInvocation,
  };
}
