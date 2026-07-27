import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  coreEventTypes,
  preferencesFileName,
  preferencesPath,
  type BusEvent,
} from "@sovereign/protocol";

import { appearancePreferencesRoutes, publishAppearanceChanges } from "./appearance-preferences.ts";
import { createDispatcher } from "./dispatcher.ts";
import { createEventBus } from "./event-bus.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createSettingsStore, type SettingsStore } from "./settings.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-appearance-"));
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
      routes: appearancePreferencesRoutes({ settings: store, logger }),
      logger,
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (method: string, body?: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        { host: "127.0.0.1", port, method, path: preferencesPath },
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

  const preferencesFile = join(directory, preferencesFileName);

  return {
    directory,
    store,
    get: () => call("GET"),
    put: (body: string) => call("PUT", body),
    stored: () => JSON.parse(readFileSync(preferencesFile, "utf8")) as unknown,
  };
}

const midnight = { appearance: { colorScheme: "midnight", variant: "dark" }, locale: "ru" };

describe("appearancePreferencesRoutes", () => {
  it("answers with the defaults when the file says nothing", async () => {
    const { get } = await serve();
    const answer = await get();

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), {
      appearance: { colorScheme: "base", variant: "system" },
      locale: "en",
    });
  });

  it("writes the file and answers with what is now in effect", async () => {
    const { get, put, stored } = await serve();
    const answer = await put(JSON.stringify(midnight));

    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), midnight);
    assert.deepEqual(stored(), midnight);
    assert.deepEqual(JSON.parse((await get()).body), midnight);
  });

  it("keeps the plugin records the same file holds", async () => {
    const { put, store, stored } = await serve();

    store.writePluginPreferences("data:hello", { enabled: false, disabledContributions: [] });
    await put(JSON.stringify(midnight));

    assert.deepEqual(stored(), {
      plugins: { "data:hello": { enabled: false, disabledContributions: [] } },
      ...midnight,
    });
  });

  it("refuses a body that names only one half of the section", async () => {
    const { put } = await serve();
    const answer = await put(JSON.stringify({ appearance: { variant: "dark" } }));

    assert.equal(answer.status, 400);
    assert.match(answer.body, /locale is required/);
  });

  it("refuses a body with an unknown variant and writes nothing", async () => {
    const { directory, put } = await serve();
    const answer = await put(
      JSON.stringify({ appearance: { colorScheme: "base", variant: "bright" }, locale: "en" }),
    );

    assert.equal(answer.status, 400);
    assert.match(answer.body, /light, dark, system/);
    assert.equal(existsSync(join(directory, preferencesFileName)), false);
  });

  it("answers 409 when the file on disk cannot be read", async () => {
    const { directory, put } = await serve();

    writeFileSync(join(directory, preferencesFileName), "{ broken");

    const answer = await put(JSON.stringify(midnight));

    assert.equal(answer.status, 409);
    assert.equal(readFileSync(join(directory, preferencesFileName), "utf8"), "{ broken");
  });
});

describe("publishAppearanceChanges", () => {
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

  it("says nothing while the section stays the same", () => {
    const directory = mkdtempSync(join(workspace, "quiet-"));
    const store = startedStore(directory);
    const { events, bus } = published();

    publishAppearanceChanges({ settings: store, bus });
    store.writePluginPreferences("data:hello", { enabled: true, disabledContributions: [] });

    assert.deepEqual(events, []);
  });

  it("publishes a hand edit of the file", async () => {
    const directory = mkdtempSync(join(workspace, "edited-"));
    const store = startedStore(directory);
    const { events, bus } = published();

    publishAppearanceChanges({ settings: store, bus });

    // Атомарная замена, как её делает и платформа: наблюдатель за файлом иначе молчит (ADR-0033).
    // Запись повторяется, потому что наблюдатель встаёт не мгновенно и события первых миллисекунд
    // теряются насовсем (runtime-checks.md, проверка 14).
    const replace = (): void => {
      const temporary = join(directory, `${preferencesFileName}.tmp`);

      writeFileSync(temporary, `${JSON.stringify(midnight)}\n`);
      renameSync(temporary, join(directory, preferencesFileName));
    };
    const repeat = setInterval(replace, 50);

    replace();

    try {
      await waitFor(() => events.length > 0, "the appearance change to reach the bus");
    } finally {
      clearInterval(repeat);
    }

    assert.deepEqual(events, [{ type: coreEventTypes.preferencesChanged, payload: {} }]);
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
