import { parseArguments } from "./arguments.ts";
import { ensureDataDirectory } from "./data-directory.ts";
import { acquireInstanceLock, InstanceLockError } from "./instance-lock.ts";
import { createLogger } from "./logger.ts";
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

// Уровень читается в момент записи, поэтому правка config.json меняет его без перезапуска.
const logger = createLogger({
  source: "core",
  level: () => settings.current().config.logLevel,
});

// Файлы читаются после создания логгера: диагностика первого чтения обязана в него попасть.
settings.start(logger);

settings.subscribe((snapshot) => {
  logger.info("settings reloaded", { logLevel: snapshot.config.logLevel });
});

const server = createDaemonServer(new Date());

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
    server.close();
    server.closeAllConnections();
    settings.close();
    lock.release();
  });
}
