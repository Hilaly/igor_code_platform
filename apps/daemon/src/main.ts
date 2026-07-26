import { parseArguments } from "./arguments.ts";
import { ensureDataDirectory } from "./data-directory.ts";
import { acquireInstanceLock, InstanceLockError } from "./instance-lock.ts";
import { createDaemonServer } from "./server.ts";

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

const server = createDaemonServer(new Date());

server.listen(port, "127.0.0.1", () => {
  console.log(`daemon listening on http://127.0.0.1:${port}, data directory ${directory}`);
});

// Лок держится ровно столько, сколько живёт процесс: после kill -9 файл остаётся, и его
// подхватит проверка на протухание при следующем старте (ADR-0008).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
    lock.release();
  });
}
