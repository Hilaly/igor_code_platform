import assert from "node:assert/strict";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  configFileName,
  configPath,
  coreEventTypes,
  defaultConfig,
  type BusEvent,
  type LogRecord,
} from "@sovereign/protocol";

import { configRoutes, publishConfigChanges } from "./config-api.ts";
import { createDispatcher } from "../http/public.ts";
import { createEventBus } from "../platform/public.ts";
import { createLogger, type Logger } from "../platform/public.ts";
import { createSettingsStore, type SettingsStore } from "./settings.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-config-"));
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

const quietLogger = (): Logger =>
  createLogger({ source: "core", level: () => "debug", write: () => {} });

type Answer = { status: number; body: string };

function startedStore(directory: string): SettingsStore {
  const store = createSettingsStore({ directory, debounceMilliseconds: 10 });

  stores.push(store);
  store.start(quietLogger());

  return store;
}

async function serve() {
  const directory = mkdtempSync(join(workspace, "case-"));
  const store = startedStore(directory);
  const logger = quietLogger();
  const server = createServer(
    createDispatcher({
      routes: configRoutes({ settings: store, logger }),
      logger,
      authenticate: () => ({ kind: "session" as const, id: "the-session" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (method: string, body?: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path: configPath,
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

  return {
    directory,
    store,
    get: () => call("GET"),
    put: (body: unknown) => call("PUT", JSON.stringify(body)),
    stored: () => JSON.parse(readFileSync(join(directory, configFileName), "utf8")) as unknown,
  };
}

describe("configRoutes", () => {
  it("answers with the defaults when the file says nothing", async () => {
    const { get } = await serve();
    const answer = await get();

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), defaultConfig);
  });

  it("writes a partial config without replacing its neighbors", async () => {
    const { get, put, stored } = await serve();
    const answer = await put({ maxConcurrentTurns: 8 });

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), { ...defaultConfig, maxConcurrentTurns: 8 });
    assert.deepEqual(stored(), { maxConcurrentTurns: 8 });
    assert.deepEqual(JSON.parse((await get()).body), { ...defaultConfig, maxConcurrentTurns: 8 });
  });

  it("has the new values in the snapshot by the time the answer comes back", async () => {
    // Ловушка среза 11b: значения конфига спрашиваются замыканиями на `settings.current()`, и
    // таблица маршрутов плагина пересобирается по ключу со своим пределом тела. Запись через API
    // обязана применяться там же, где применяется правка файла руками, — то есть сразу, не дожидаясь
    // наблюдателя за директорией (docs/web-api.md).
    const { put, store } = await serve();

    await put({ pluginRouteBodyLimitBytes: 4096 });

    assert.equal(store.current().config.pluginRouteBodyLimitBytes, 4096);
  });

  it("changes the level of a live logger", async () => {
    // Логгер получает уровень функцией, а не значением: иначе `logLevel` применялся бы только при
    // перезапуске демона, а конфиг обещает обратное (docs/data-directory.md).
    const { put, store } = await serve();
    const written: LogRecord[] = [];
    const logger = createLogger({
      source: "core",
      level: () => store.current().config.logLevel,
      write: (record) => written.push(record),
    });

    logger.info("before");
    await put({ logLevel: "error" });
    logger.info("after");

    assert.deepEqual(
      written.map((record) => record.message),
      ["before"],
    );
  });

  it("keeps a key the schema does not know", async () => {
    // Файл, написанный более новой платформой, не должен худеть от записи из интерфейса
    // (docs/data-directory.md).
    const { directory, put, stored } = await serve();

    writeFileSync(
      join(directory, configFileName),
      `${JSON.stringify({ ...defaultConfig, futureKey: "keep me" })}\n`,
    );

    const answer = await put({ maxConcurrentTurns: 8 });

    assert.equal(answer.status, 200);
    assert.deepEqual(stored(), { ...defaultConfig, maxConcurrentTurns: 8, futureKey: "keep me" });
  });

  it("keeps a key the schema does not know when the body brings it", async () => {
    // Клиент более новой версии может прислать ключ, которого этот демон ещё не применяет. Запись
    // обязана сохранить его в документе, но ответ описывает только известный применяемый снимок.
    const { put, stored } = await serve();
    const answer = await put({ maxConcurrentTurns: 8, futureKey: "keep me" });

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), { ...defaultConfig, maxConcurrentTurns: 8 });
    assert.deepEqual(stored(), {
      maxConcurrentTurns: 8,
      futureKey: "keep me",
    });
  });

  it("refuses an empty body and writes nothing", async () => {
    const { directory, put } = await serve();
    const answer = await put({});

    assert.equal(answer.status, 400);
    assert.match(answer.body, /at least one.*key is required/);
    assert.equal(existsSync(join(directory, configFileName)), false);
  });

  it("refuses a body that names only unknown fields and writes nothing", async () => {
    const { directory, put } = await serve();
    const answer = await put({ futureKey: "keep me" });

    assert.equal(answer.status, 400);
    assert.match(answer.body, /at least one known key is required/);
    assert.equal(existsSync(join(directory, configFileName)), false);
  });

  it("refuses a wrong value and writes nothing", async () => {
    const { directory, put } = await serve();
    const answer = await put({ hookTimeoutMilliseconds: 0 });

    assert.equal(answer.status, 400);
    assert.match(answer.body, /hookTimeoutMilliseconds must be an integer above zero/);
    assert.equal(existsSync(join(directory, configFileName)), false);
  });

  it("answers 409 when the file on disk cannot be read", async () => {
    // Чинить негодный файл записью поверх нельзя: там чужая правка (docs/data-directory.md).
    const { directory, put } = await serve();

    writeFileSync(join(directory, configFileName), "{ broken");

    const answer = await put({ maxConcurrentTurns: 8 });

    assert.equal(answer.status, 409);
    assert.equal(readFileSync(join(directory, configFileName), "utf8"), "{ broken");
  });

  // Права проверяются ядром, а root их не спрашивает: под ним запись прошла бы и проверка стала бы
  // ложно красной.
  it(
    "names the reason when the file system refuses the write",
    { skip: process.getuid?.() === 0 },
    async () => {
      const { directory, put } = await serve();

      chmodSync(directory, 0o555);

      try {
        const answer = await put({ maxConcurrentTurns: 8 });

        // Не `internal error`: причину отказа чинит человек, и без неё он не знает, что чинить.
        assert.equal(answer.status, 500);
        assert.match(answer.body, /config\.json was not written: /);
      } finally {
        chmodSync(directory, 0o755);
      }
    },
  );

  it("keeps both changes from two partial writes", async () => {
    const { put, stored } = await serve();

    assert.equal((await put({ logLevel: "debug" })).status, 200);
    const answer = await put({ maxConcurrentTurns: 8 });

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), {
      ...defaultConfig,
      logLevel: "debug",
      maxConcurrentTurns: 8,
    });
    assert.deepEqual(stored(), { logLevel: "debug", maxConcurrentTurns: 8 });
  });
});

describe("publishConfigChanges", () => {
  const published = (): { events: BusEvent[]; bus: ReturnType<typeof createEventBus> } => {
    const events: BusEvent[] = [];
    const bus = createEventBus({
      onListenerError: (cause) => {
        throw cause;
      },
    });

    bus.subscribe((event) => events.push(event));

    return { events, bus };
  };

  it("says nothing when the other settings file changes", () => {
    // Оба файла будят одного наблюдателя, но форме конфига о смене темы сказать нечего.
    const directory = mkdtempSync(join(workspace, "quiet-"));
    const store = startedStore(directory);
    const { events, bus } = published();

    publishConfigChanges({ settings: store, bus });
    store.writeAppearancePreferences({
      appearance: { colorScheme: "imperium", variant: "dark", scale: "default" },
      locale: "ru",
    });

    assert.deepEqual(events, []);
  });

  it("publishes a hand edit of the file", async () => {
    const directory = mkdtempSync(join(workspace, "edited-"));
    const store = startedStore(directory);
    const { events, bus } = published();

    publishConfigChanges({ settings: store, bus });

    // Атомарная замена, как её делает и платформа: наблюдатель за файлом иначе молчит
    // (docs/data-directory.md). Запись повторяется, потому что наблюдатель встаёт не мгновенно и
    // события первых миллисекунд теряются насовсем (runtime-checks.md, проверка 14).
    const replace = (): void => {
      const temporary = join(directory, `${configFileName}.tmp`);

      writeFileSync(temporary, `${JSON.stringify({ ...defaultConfig, logLevel: "warn" })}\n`);
      renameSync(temporary, join(directory, configFileName));
    };
    const repeat = setInterval(replace, 50);

    replace();

    try {
      await waitFor(() => events.length > 0, "the config change to reach the bus");
    } finally {
      clearInterval(repeat);
    }

    assert.deepEqual(events, [{ type: coreEventTypes.configChanged, payload: {} }]);
  });
});

async function waitFor(done: () => boolean, hint: string): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (!done()) {
    if (Date.now() > deadline) {
      throw new Error(`waited for ${hint} in vain`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
