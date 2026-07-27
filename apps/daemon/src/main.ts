import { appearancePreferencesRoutes, publishAppearanceChanges } from "./appearance-preferences.ts";
import { parseArguments } from "./arguments.ts";
import { createContributionRegistry } from "./contribution-registry.ts";
import { ensureDataDirectory } from "./data-directory.ts";
import { createEventBus } from "./event-bus.ts";
import { createEventStream } from "./event-stream.ts";
import { healthRoute } from "./health.ts";
import { acquireInstanceLock, InstanceLockError } from "./instance-lock.ts";
import { createLogger } from "./logger.ts";
import { pluginPreferencesRoute } from "./plugin-preferences.ts";
import { createPluginSupervisor } from "./plugin-supervisor.ts";
import { defaultPluginRoots, discoverPlugins } from "./plugin-sources.ts";
import { createPluginWatcher } from "./plugin-watcher.ts";
import { pluginsRoute } from "./plugins-snapshot.ts";
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

// Логгер зовётся здесь напрямую: запись уходит в `stdout` и на шину не возвращается (ADR-0074),
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

const pluginRoots = defaultPluginRoots(directory);

const contributions = createContributionRegistry();

const plugins = createPluginSupervisor({
  logger,
  registry: contributions,
  bus,
  createPluginLogger: (source) =>
    createLogger({ source, level: () => settings.current().config.logLevel }),
});

// Приведения идут цепочкой: два одновременных перечитывания настроек не должны поднимать один
// плагин дважды.
let applying = Promise.resolve();

const applyPlugins = (changedDirectories: string[] = []): void => {
  applying = applying
    .then(async () => {
      await plugins.apply(discoverPlugins(pluginRoots), settings.current().preferences);
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

const pluginWatcher = createPluginWatcher({
  roots: pluginRoots,
  logger,
  onChange: applyPlugins,
});

// Наблюдатель ставится до первого обхода: правка, потерянная не успевшим встать наблюдателем, при
// таком порядке всё равно попадает в первый снимок (runtime-checks.md, проверка 14).
pluginWatcher.start();
applyPlugins();

// Поток подписывается на шину последним из подписчиков ядра, но нумерует всё, что придёт после:
// события до его создания рассказывать некому — клиентов ещё нет.
const events = createEventStream({ bus, logger });

const server = createDaemonServer({
  logger,
  routes: [
    healthRoute(new Date()),
    pluginsRoute({ plugins, registry: contributions }),
    pluginPreferencesRoute({ settings, plugins, logger }),
    ...appearancePreferencesRoutes({ settings, logger }),
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
// подхватит проверка на протухание при следующем старте (ADR-0008).
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

    // Лок снимается последним и в любом случае: воркер, зависший на выгрузке, не имеет права
    // оставить директорию данных запертой.
    void plugins.stopAll().finally(() => lock.release());
  });
}
