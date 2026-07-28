import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  pluginPreferencesPath,
  preferencesFileName,
  type LogRecord,
  type PluginStatus,
} from "@sovereign/protocol";

import { createDispatcher } from "./dispatcher.ts";
import { createLogger } from "./logger.ts";
import { pluginPreferencesRoute } from "./plugin-preferences.ts";
import { createSettingsStore, type SettingsStore, type WriteOutcome } from "./settings.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-preferences-"));
const servers: Server[] = [];
const stores: SettingsStore[] = [];

after(async () => {
  for (const store of stores) {
    store.close();
  }

  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  rmSync(workspace, { recursive: true, force: true });
});

const hello: PluginStatus = {
  key: "data:hello",
  id: "hello",
  source: "data",
  directory: "/plugins/hello",
  state: "disabled",
};

type Answer = { status: number; body: string };

async function serve(settings: Pick<SettingsStore, "writePluginPreferences">) {
  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });

  const route = pluginPreferencesRoute({
    settings,
    plugins: { statuses: () => [hello] },
    logger,
  });

  const server = createServer(
    // Вход этих тестов не касается: сессия есть всегда.
    createDispatcher({
      routes: [route],
      logger,
      authenticate: () => ({ kind: "session" as const, id: "the-session" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const put = (pluginKey: string, body: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        {
          host: "127.0.0.1",
          port,
          method: "PUT",
          path: pluginPreferencesPath(pluginKey),
          // Изменяющий запрос обязан называть себя json, как это делает интерфейс: иначе диспетчер
          // отвечает `415` (docs/web-api.md).
          headers: { "content-type": "application/json" },
        },
        (incoming) => {
          let text = "";

          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            text += chunk;
          });
          incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: text }));
        },
      );

      outgoing.on("error", reject);
      outgoing.end(body);
    });

  return { put, records };
}

/** Хранилище на настоящей директории: проверяется в том числе то, что записано на диск. */
async function serveWithStore() {
  const directory = mkdtempSync(join(workspace, "case-"));
  const store = createSettingsStore({ directory, debounceMilliseconds: 10 });

  stores.push(store);
  store.start(createLogger({ source: "core", level: () => "debug", write: () => {} }));

  const served = await serve(store);
  const preferencesFile = join(directory, preferencesFileName);

  return {
    ...served,
    store,
    preferencesFile,
    stored: () => JSON.parse(readFileSync(preferencesFile, "utf8")) as unknown,
  };
}

describe("pluginPreferencesRoute", () => {
  it("writes the file and applies it before answering", async () => {
    const { put, store, stored } = await serveWithStore();

    const answer = await put("data:hello", JSON.stringify({ enabled: true }));

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), {
      key: "data:hello",
      preferences: { enabled: true, disabledContributions: [] },
    });
    assert.deepEqual(stored(), {
      plugins: { "data:hello": { enabled: true, disabledContributions: [] } },
    });
    assert.deepEqual(store.current().preferences.plugins["data:hello"], {
      enabled: true,
      disabledContributions: [],
    });
  });

  it("switches a single contribution off without touching the plugin", async () => {
    const { put, store } = await serveWithStore();

    await put(
      "data:hello",
      JSON.stringify({ enabled: true, disabledContributions: ["hello.greeting"] }),
    );

    assert.deepEqual(store.current().preferences.plugins["data:hello"], {
      enabled: true,
      disabledContributions: ["hello.greeting"],
    });
  });

  it("refuses a body of the wrong shape and leaves the file alone", async () => {
    const { put, preferencesFile } = await serveWithStore();

    const answer = await put("data:hello", JSON.stringify({ enabled: "yes" }));

    assert.equal(answer.status, 400);
    assert.match(JSON.parse(answer.body).error, /enabled must be a boolean/);
    assert.throws(() => readFileSync(preferencesFile, "utf8"), /ENOENT/);
  });

  it("answers 404 for a plugin the daemon does not know", async () => {
    const { put, preferencesFile } = await serveWithStore();

    const answer = await put("data:missing", JSON.stringify({ enabled: true }));

    assert.equal(answer.status, 404);
    assert.throws(() => readFileSync(preferencesFile, "utf8"), /ENOENT/);
  });

  it("reports a refused write as a conflict and writes down why", async () => {
    const refused: WriteOutcome = { kind: "refused", reason: "preferences.json is not valid json" };
    const { put, records } = await serve({ writePluginPreferences: () => refused });

    const answer = await put("data:hello", JSON.stringify({ enabled: true }));

    assert.equal(answer.status, 409);
    assert.match(JSON.parse(answer.body).error, /not valid json/);
    assert.equal(
      records.find((record) => record.message === "the plugin preferences were not written")?.level,
      "error",
    );
  });
});
