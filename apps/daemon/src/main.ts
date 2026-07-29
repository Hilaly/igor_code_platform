import { createAccountStore } from "./account.ts";
import { appearancePreferencesRoutes, publishAppearanceChanges } from "./appearance-preferences.ts";
import { parseArguments } from "./arguments.ts";
import { authenticationRoutes, createSessionCheck } from "./authentication.ts";
import { createContributionRegistry } from "./contribution-registry.ts";
import { createCredentialStore } from "./credential-store.ts";
import { ensureDataDirectory } from "./data-directory.ts";
import { createEventBus } from "./event-bus.ts";
import { createProviderCatalogue, processEnvironment } from "@sovereign/agent-runtime-pi";

import { createEventStream } from "./event-stream.ts";
import { healthRoute } from "./health.ts";
import { acquireInstanceLock, InstanceLockError } from "./instance-lock.ts";
import { createLoginSessionStore } from "./login-sessions.ts";
import { createLogger } from "./logger.ts";
import { createModelCatalogStore } from "./model-catalog-store.ts";
import { pluginPreferencesRoute } from "./plugin-preferences.ts";
import { createPluginSupervisor } from "./plugin-supervisor.ts";
import { defaultPluginRoots, discoverPlugins, projectPluginRoots } from "./plugin-sources.ts";
import { createPluginWatcher } from "./plugin-watcher.ts";
import type { PluginRoot } from "./plugin-sources.ts";
import { pluginsRoute } from "./plugins-snapshot.ts";
import { createProjectAvailabilityWatcher } from "./project-availability.ts";
import { createProjectPathNormalizer } from "./project-path.ts";
import { createProjectStore } from "./project-store.ts";
import { projectsRoutes, publishProjectChanges } from "./projects.ts";
import { carryLoginSteps, providerLoginRoutes } from "./provider-login-routes.ts";
import { createProviderLogins } from "./provider-logins.ts";
import { providersRoutes } from "./providers.ts";
import { createDaemonServer } from "./server.ts";
import { createSettingsStore } from "./settings.ts";

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

// Единственный писатель кредов в системе (docs/models-and-providers.md).
const credentials = createCredentialStore({ directory, logger });

// Кэш динамических списков моделей: без него они читаются из сети на каждый старт демона.
const modelCatalogs = createModelCatalogStore({ directory, logger });

const providers = createProviderCatalogue({
  credentials,
  catalogs: modelCatalogs,
  environment: processEnvironment(),
});

// Реестр попыток входа в памяти: попытка — живой диалог с провайдером, и перезапуск демона она
// пережить не может (docs/models-and-providers.md).
const providerLogins = createProviderLogins({ runner: providers, logger });

// Доступность папок считается по таймеру, а не `fs.watch`: наблюдатель на папке молчит и об
// отмонтировании тома, и о его возврате (runtime-checks.md, проверка 27).
const projectAvailability = createProjectAvailabilityWatcher({
  projects,
  bus,
  onChange: () => applyPlugins(),
});

// Корни перестали быть константой: папки проектов появляются и исчезают на живом демоне
// (docs/plugins.md). Считаются они каждый раз заново — набор проектов между обходами меняется.
const pluginRoots = (): PluginRoot[] => [
  ...defaultPluginRoots(directory),
  ...projectPluginRoots(projects.list(), (project) => projectAvailability.of(project.id)),
];

const contributions = createContributionRegistry();

const plugins = createPluginSupervisor({
  logger,
  registry: contributions,
  bus,
  createPluginLogger: (source) =>
    createLogger({ source, level: () => settings.current().config.logLevel }),
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

const applyPlugins = (changedDirectories: string[] = []): void => {
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
};

settings.subscribe((snapshot) => {
  logger.info("settings reloaded", { logLevel: snapshot.config.logLevel });
  applyPlugins();
});

publishAppearanceChanges({ settings, bus });
publishProjectChanges({ projects, bus });

// Список проектов меняет набор корней: созданный проект приносит источник, архивированный уносит.
projects.subscribe(() => applyPlugins());

// Наблюдатель ставится до первого обхода: правка, потерянная не успевшим встать наблюдателем, при
// таком порядке всё равно попадает в первый снимок (runtime-checks.md, проверка 14).
pluginWatcher.start();
armedRoots = pluginRoots()
  .map((root) => root.directory)
  .join("\n");
applyPlugins();

// Поток подписывается на шину последним из подписчиков ядра, но нумерует всё, что придёт после:
// события до его создания рассказывать некому — клиентов ещё нет.
const events = createEventStream({ bus, logger });

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
    }),
    ...providersRoutes({ catalogue: providers, credentials, logger, bus }),
    ...providerLoginRoutes({ logins: providerLogins, credentials }),
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
    loginSessions.stop();
    projectAvailability.stop();

    // Лок снимается последним и в любом случае: воркер, зависший на выгрузке, не имеет права
    // оставить директорию данных запертой.
    void plugins.stopAll().finally(() => lock.release());
  });
}
