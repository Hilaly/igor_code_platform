import { join } from "node:path";
import { homedir } from "node:os";

import { coreEventTypes, parseModelReference } from "@sovereign/protocol";

import {
  authenticationRoutes,
  createAccountStore,
  createLoginSessionStore,
  createSessionCheck,
} from "./authentication/public.ts";
import { parseArguments } from "./platform/public.ts";
import {
  createCredentialStore,
  createUserProviderStore,
  createUserProviders,
} from "./providers/public.ts";
import {
  archivedSessionsDirectoryName,
  ensureDataDirectory,
  sessionsDirectoryName,
} from "./platform/public.ts";
import { createEventBus } from "./platform/public.ts";
import {
  createAgentSessionStore,
  createProviderCatalogue,
  processEnvironment,
} from "@sovereign/agent-runtime-pi";

import { createEventStream } from "./http/public.ts";
import { healthRoute } from "./http/public.ts";
import { acquireInstanceLock, InstanceLockError } from "./platform/public.ts";
import { createLogger } from "./platform/public.ts";
import { createModelCatalogStore } from "./providers/public.ts";
import {
  createContributionRegistry,
  createPluginProviders,
  createPluginSessions,
  createPluginSupervisor,
  createPluginWatcher,
  createStandaloneFileResourceService,
  type ChangedPluginDirectory,
  defaultPluginRoots,
  discoverPlugins,
  isSessionRequest,
  pluginPreferencesRoute,
  pluginsRoute,
  projectPluginRoots,
  standaloneResourceRoots,
  type PluginRoot,
  type PluginSessions,
} from "./plugins/public.ts";
import { createProjectAvailabilityWatcher, projectResourceRoutes } from "./projects/public.ts";
import { createProjectPathNormalizer } from "./projects/public.ts";
import { createProjectStore } from "./projects/public.ts";
import { createProjectLifecycle } from "./projects/public.ts";
import {
  coreToolSource,
  createSessionService,
  createToolCollector,
  createTurnQueue,
} from "./sessions/public.ts";
import { projectsRoutes, publishProjectChanges } from "./projects/public.ts";
import { filesystemRoutes } from "./http/public.ts";
import { carryLoginSteps, providerLoginRoutes, publishLoginOutcomes } from "./providers/public.ts";
import { createProviderLogins } from "./providers/public.ts";
import { providersRoutes } from "./providers/public.ts";
import { userProviderRoutes } from "./providers/public.ts";
import { createDaemonServer } from "./http/public.ts";
import {
  appearancePreferencesRoutes,
  createSettingsStore,
  publishAppearanceChanges,
} from "./settings/public.ts";

const parsed = parseArguments(process.argv.slice(2));

if (parsed.kind === "help") {
  process.stdout.write(`${parsed.text}\n`);
  process.exit(0);
}

if (parsed.kind === "error") {
  process.stderr.write(`${parsed.message}\nRun with --help to see the usage.\n`);
  process.exit(1);
}

const { dataDirectory, port } = parsed.options;
const directory = ensureDataDirectory(dataDirectory);

const lock = (() => {
  try {
    return acquireInstanceLock({ directory, port });
  } catch (cause) {
    if (cause instanceof InstanceLockError) {
      process.stderr.write(`${cause.message}\n`);
      process.exit(1);
    }

    throw cause;
  }
})();

const settings = createSettingsStore({ directory });

// Логгер зовётся здесь напрямую: запись уходит в `stdout` и на шину не возвращается (docs/logging.md),
// поэтому цикла «упавший подписчик → журнал → тот же подписчик» больше нет.
const bus = createEventBus({
  onListenerError: (cause, event) => {
    logger.error("the event bus listener failed", {
      event: event.type,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  },
});

// Уровень читается в момент записи, поэтому правка config.json меняет его без перезапуска.
const logger = createLogger({
  source: "core",
  level: () => settings.current().config.logLevel,
});

// Файлы читаются после создания логгера: диагностика первого чтения обязана в него попасть.
settings.start(logger);

// Один нормализатор на демон: складка пути обязана быть общей у стора и у маршрутов, иначе второй
// проект встанет на ту же папку, что первый (docs/sessions-and-projects.md).
const normalizeProjectFolder = createProjectPathNormalizer();
const projects = createProjectStore({ directory, logger, normalizePath: normalizeProjectFolder });
const projectLifecycle = createProjectLifecycle();

// Единственный писатель кредов в системе (docs/models-and-providers.md).
const credentials = createCredentialStore({ directory, logger });

// Кэш динамических списков моделей: без него они читаются из сети на каждый старт демона.
const modelCatalogs = createModelCatalogStore({ directory, logger });

const providers = createProviderCatalogue({
  credentials,
  catalogs: modelCatalogs,
  environment: processEnvironment(),
});

const userProviderStore = createUserProviderStore({ directory, logger });
let hasActiveProviderSession = (_providerId: string): boolean => false;
const userProviders = createUserProviders({
  store: userProviderStore,
  catalogue: providers,
  credentials,
  catalogs: modelCatalogs,
  hasActiveSession: (providerId) => hasActiveProviderSession(providerId),
});

// Реестр попыток входа в памяти: попытка — живой диалог с провайдером, и перезапуск демона она
// пережить не может (docs/models-and-providers.md).
const providerLogins = createProviderLogins({ runner: providers, logger });

// Доступность папок считается по таймеру, а не `fs.watch`: наблюдатель на папке молчит и об
// отмонтировании тома, и о его возврате (runtime-checks.md, проверка 27).
const projectAvailability = createProjectAvailabilityWatcher({
  projects,
  bus,
  onChange: () => applyFileSources(),
});

// Корни перестали быть константой: папки проектов появляются и исчезают на живом демоне
// (docs/plugins.md). Считаются они каждый раз заново — набор проектов между обходами меняется.
const pluginRoots = (): PluginRoot[] => [
  ...defaultPluginRoots(directory),
  ...projectPluginRoots(projects.list(), (project) => projectAvailability.of(project.id)),
];

const contributions = createContributionRegistry();

// Единого снимка без project context нет: событие только инвалидирует выбранный проект. Оба
// производителя зовут один publisher, а revision не даёт повторному scan разбудить клиентов.
let publishedContributionRevision = contributions.revision();
const publishContributionChanges = (): void => {
  const revision = contributions.revision();

  if (revision === publishedContributionRevision) {
    return;
  }

  publishedContributionRevision = revision;
  bus.publish(coreEventTypes.contributionsChanged, { revision });
};

const standaloneRoots = () =>
  standaloneResourceRoots({
    dataDirectory: directory,
    homeDirectory: homedir(),
    projects: projects.list(),
    availability: (project) => projectAvailability.of(project.id),
  });

const standaloneResources = createStandaloneFileResourceService({
  roots: standaloneRoots(),
  registry: contributions,
  logger,
  publishContributionChanges,
});

// Мост провайдеров: единственная пара «запрос-ответ» в канале плагина
// (docs/models-and-providers.md). Каталог тот же, что у веб-API, — иначе плагин и человек видели бы
// разные коллекции провайдеров.
const pluginProviders = createPluginProviders({
  catalogue: providers,
  logins: providerLogins,
  credentials,
  bus,
  logger,
});

/**
 * Мост сессий подключается позже: служба сессий строится после потока событий, а супервизор нужен
 * раньше него. Ссылка поздняя, а не служба ранняя, потому что порядок обратный невозможен — потоку
 * нужен уже поднятый супервизор.
 */
const pluginSessions: { answer?: PluginSessions["answer"] } = {};

const plugins = createPluginSupervisor({
  logger,
  registry: contributions,
  bus,
  publishContributionChanges,
  createPluginLogger: (source) =>
    createLogger({ source, level: () => settings.current().config.logLevel }),
  onRequest: async (plugin, request, call) => {
    if (!isSessionRequest(request)) {
      return pluginProviders.request(plugin, request, call);
    }

    return (
      (await pluginSessions.answer?.(request)) ?? {
        kind: "failed",
        reason: "this daemon answers nothing about sessions yet",
      }
    );
  },
  onLoginReply: pluginProviders.reply,
  onPluginGone: pluginProviders.remove,
});

const pluginWatcher = createPluginWatcher({
  roots: pluginRoots(),
  logger,
  onChange: (changedDirectories) => applyPlugins(changedDirectories),
});

// Приведения идут цепочкой: два одновременных перечитывания настроек не должны поднимать один
// плагин дважды.
let applying = Promise.resolve();
let armedRoots = "";

const applyPlugins = (changedDirectories: ChangedPluginDirectory[] = []): Promise<void> => {
  applying = applying
    .then(async () => {
      const roots = pluginRoots();
      const signature = roots.map((root) => root.directory).join("\n");

      // Наблюдатели переставляются только когда набор корней действительно изменился: между
      // снятием и постановкой есть окно, в котором не видно ничего (проверка 14), и открывать его
      // на каждую правку файла плагина незачем. Переставляются до обхода, а не после: правка,
      // потерянная не успевшим встать наблюдателем, при таком порядке попадает в этот же обход.
      if (signature !== armedRoots) {
        armedRoots = signature;
        pluginWatcher.rearm(roots);
      }

      await plugins.apply(discoverPlugins(roots), settings.current().preferences);
      await plugins.reload(changedDirectories);
    })
    .catch((cause: unknown) => {
      logger.error("applying the plugin state failed", {
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    });

  return applying;
};

const applyFileSources = (): void => {
  void applyPlugins();
  void standaloneResources.rearm(standaloneRoots()).catch((cause: unknown) => {
    logger.error("applying standalone file resource roots failed", {
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  });
};

settings.subscribe((snapshot) => {
  logger.info("settings reloaded", { logLevel: snapshot.config.logLevel });
  applyPlugins();
});

publishAppearanceChanges({ settings, bus });
publishProjectChanges({ projects, bus });

// Список проектов меняет набор корней: созданный проект приносит источник, архивированный уносит.
projects.subscribe(() => applyFileSources());

// Наблюдатель ставится до первого обхода: правка, потерянная не успевшим встать наблюдателем, при
// таком порядке всё равно попадает в первый снимок (runtime-checks.md, проверка 14).
pluginWatcher.start();
armedRoots = pluginRoots()
  .map((root) => root.directory)
  .join("\n");
const initialPluginApplication = applyPlugins();
const initialStandaloneApplication = standaloneResources.start();

// Поток подписывается на шину последним из подписчиков ядра, но нумерует всё, что придёт после:
// события до его создания рассказывать некому — клиентов ещё нет.
const events = createEventStream({ bus, logger });

// Сессии агента. Хранилище, очередь и сборка инструментов заводятся здесь, а не внутри службы:
// коллекция моделей у сессий та же, что у каталога провайдеров, — второй экземпляр означал бы
// вторые креды и второй набор кастомных провайдеров (docs/models-and-providers.md).
const toolCollector = createToolCollector();

toolCollector.register(coreToolSource());

const sessions = createSessionService({
  store: createAgentSessionStore({
    models: providers.models,
    directory: join(directory, sessionsDirectoryName),
    archivedDirectory: join(directory, archivedSessionsDirectoryName),
    // Читаются живьём по той же причине, что и предел турнов: правка `config.json` применяется без
    // перезапуска демона, а снимок настроек устарел бы молча.
    compactionSettings: () => ({
      reserveTokens: settings.current().config.compactionReserveTokens,
      keepRecentTokens: settings.current().config.compactionKeepRecentTokens,
    }),
  }),
  projects,
  contributions: {
    base: () => contributions.resolvedBase(),
    forProject: (projectId) => contributions.resolvedForProject(projectId),
  },
  tools: toolCollector,
  queue: createTurnQueue({
    // Предел читается живьём: правка `config.json` применяется без перезапуска демона.
    limit: () => settings.current().config.maxConcurrentTurns,
    onFailure: (sessionId, reason) =>
      logger.error("a turn failed", { session: sessionId, reason: String(reason) }),
  }),
  bus,
  emitDelta: (frame) => events.emitSessionDelta(frame),
  logger,
  projectLifecycle,
  availability: (project) => projectAvailability.of(project.id),
  // Автопорог тоже живой: `0` выключает его, и это умолчание (docs/sessions-and-projects.md).
  compactionThreshold: () => settings.current().config.compactionThreshold,
});

hasActiveProviderSession = (providerId) =>
  sessions
    .list()
    .some(
      (session) =>
        session.phase !== "idle" && parseModelReference(session.model)?.providerId === providerId,
    );

await Promise.all([initialPluginApplication, initialStandaloneApplication, sessions.refresh()]);

pluginSessions.answer = createPluginSessions({ sessions }).answer;

const account = createAccountStore({ directory, logger });
const loginSessions = createLoginSessionStore({
  directory,
  logger,
  isAccountPresent: () => account.state().kind === "present",
});

// Выход обрывает живой поток, а не оставляет его дожить до конца процесса (docs/authentication.md):
// проверка сессии стоит на входе в соединение, а соединение живёт часами.
loginSessions.subscribe((sessionId) => events.disconnect(sessionId));

// Тем же выходом гаснут и начатые этой сессией входы в провайдеров: отвечать на их вопросы стало
// некому. Попытки плагинов при этом живут — они не про вкладку.
loginSessions.subscribe((sessionId) => providerLogins.cancelOwnedBy(sessionId));

carryLoginSteps({ logins: providerLogins, events });
publishLoginOutcomes({
  logins: providerLogins,
  bus,
  onSucceeded: async (providerId) => {
    if (userProviders.find(providerId) !== undefined) {
      await userProviders.refresh(providerId);
      bus.publish(coreEventTypes.providersChanged, {});
    }
  },
});

const server = createDaemonServer({
  logger,
  // Проверка одна на все маршруты и живёт в диспетчере, а не в обработчиках: новый маршрут не может
  // случайно оказаться незащищённым, потому что защита не в нём (docs/web-api.md).
  authenticate: createSessionCheck({ sessions: loginSessions, account }),
  routes: [
    healthRoute(new Date()),
    ...authenticationRoutes({ account, sessions: loginSessions, logger }),
    pluginsRoute({ plugins, registry: contributions, settings }),
    pluginPreferencesRoute({ settings, plugins, logger }),
    ...appearancePreferencesRoutes({ settings, logger }),
    ...projectsRoutes({
      projects,
      logger,
      normalizePath: normalizeProjectFolder,
      availability: (project) => projectAvailability.of(project.id),
      sessionCount: (folderKey) => sessions.countByFolderKey(folderKey),
      projectLifecycle,
    }),
    ...projectResourceRoutes({
      projects,
      availability: (project) => projectAvailability.of(project.id),
      agents: (projectId) => ({ agents: sessions.agentsForProject(projectId) }),
      fileResources: (projectId) => contributions.fileResourcesForProject(projectId),
    }),
    ...sessions.routes(),
    ...providersRoutes({ catalogue: providers, credentials, logger, bus, logins: providerLogins }),
    ...userProviderRoutes({ providers: userProviders, logger, bus }),
    ...providerLoginRoutes({ logins: providerLogins, credentials }),
    ...filesystemRoutes(),
    events.route(),
  ],
});

server.listen(port, "127.0.0.1", () => {
  logger.info("daemon started", {
    url: `http://127.0.0.1:${port}`,
    dataDirectory: directory,
    logLevel: settings.current().config.logLevel,
  });
});

// Лок держится ровно столько, сколько живёт процесс: после kill -9 файл остаётся, и его
// подхватит проверка на протухание при следующем старте (docs/data-directory.md).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("daemon stopping", { signal });

    // Потоки закрываются до сервера: открытое SSE-соединение живёт, пока его не закрыли, и
    // `server.close()` ждал бы его вечно.
    events.close();
    server.close();
    server.closeAllConnections();
    settings.close();
    pluginWatcher.close();
    standaloneResources.close();
    loginSessions.stop();
    projectAvailability.stop();
    void sessions.close();

    // Лок снимается последним и в любом случае: воркер, зависший на выгрузке, не имеет права
    // оставить директорию данных запертой.
    void plugins.stopAll().finally(() => lock.release());
  });
}
