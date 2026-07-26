import { parseArguments } from "./arguments.ts";
import { ensureDataDirectory } from "./data-directory.ts";
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

const server = createDaemonServer(new Date());

server.listen(port, "127.0.0.1", () => {
  console.log(`daemon listening on http://127.0.0.1:${port}, data directory ${directory}`);
});
