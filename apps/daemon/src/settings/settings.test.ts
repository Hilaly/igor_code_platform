import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  configFileName,
  defaultConfig,
  defaultPreferences,
  preferencesFileName,
} from "@sovereign/protocol";

import type { Logger } from "../platform/public.ts";
import { createSettingsStore, type SettingsSnapshot, type SettingsStore } from "./settings.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-settings-"));
const openStores: SettingsStore[] = [];
let directoryCounter = 0;

after(() => {
  for (const store of openStores) {
    store.close();
  }

  rmSync(workspace, { recursive: true, force: true });
});

function freshDirectory(): string {
  directoryCounter += 1;

  return mkdtempSync(join(workspace, `case-${directoryCounter}-`));
}

function collectingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const record = (message: string) => {
    messages.push(message);
  };

  return { logger: { debug: record, info: record, warn: record, error: record }, messages };
}

/** Возвращает хранилище с уже прочитанными файлами и собранной диагностикой. */
function startedStore(directory: string): { store: SettingsStore; messages: string[] } {
  const { logger, messages } = collectingLogger();
  const store = createSettingsStore({ directory, debounceMilliseconds: 10 });

  openStores.push(store);
  store.start(logger);

  return { store, messages };
}

function write(directory: string, fileName: string, content: string): void {
  writeFileSync(join(directory, fileName), content);
}

/** Атомарная запись, как её делает платформа: временный файл плюс `rename` (docs/data-directory.md). */
function writeAtomically(directory: string, fileName: string, content: string): void {
  const temporary = join(directory, `${fileName}.tmp`);

  writeFileSync(temporary, content);
  renameSync(temporary, join(directory, fileName));
}

function nextSnapshot(store: SettingsStore): Promise<SettingsSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("the settings were not reloaded within the timeout"));
    }, 5000);

    const unsubscribe = store.subscribe((snapshot) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(snapshot);
    });
  });
}

/**
 * Наблюдатель встаёт не мгновенно, и события первых миллисекунд теряются насовсем
 * (runtime-checks.md, проверка 14). Поэтому запись повторяется, пока наблюдатель не отзовётся:
 * иначе тест ловил бы не поведение хранилища, а гонку с постановкой наблюдателя.
 */
async function applyAtomically(
  store: SettingsStore,
  directory: string,
  fileName: string,
  content: string,
): Promise<SettingsSnapshot> {
  const reloaded = nextSnapshot(store);
  const repeat = setInterval(() => writeAtomically(directory, fileName, content), 50);

  writeAtomically(directory, fileName, content);

  try {
    return await reloaded;
  } finally {
    clearInterval(repeat);
  }
}

test("missing files mean the defaults", () => {
  const { store, messages } = startedStore(freshDirectory());

  assert.deepEqual(store.current(), { config: defaultConfig, preferences: defaultPreferences });
  assert.deepEqual(messages, []);
});

test("a valid log level is applied", () => {
  const directory = freshDirectory();
  write(directory, configFileName, `{ "logLevel": "debug" }`);

  const { store } = startedStore(directory);

  assert.equal(store.current().config.logLevel, "debug");
});

test("broken json keeps the previous values and reports the file", () => {
  const directory = freshDirectory();
  write(directory, configFileName, `{ "logLevel": "debug" }`);

  const { store, messages } = startedStore(directory);
  write(directory, configFileName, "{ oops");
  store.reload();

  assert.equal(store.current().config.logLevel, "debug");
  assert.ok(
    messages.some((message) => message.includes("not valid json")),
    messages.join("\n"),
  );
});

test("an invalid value is refused whole-file: there is no partial application", () => {
  const directory = freshDirectory();
  write(directory, configFileName, `{ "logLevel": "trace" }`);

  const { store, messages } = startedStore(directory);

  assert.equal(store.current().config.logLevel, "info");
  assert.ok(
    messages.some((message) => message.includes("logLevel must be one of")),
    messages.join("\n"),
  );
});

test("an unknown key is a diagnostic, not a refusal", () => {
  const directory = freshDirectory();
  write(directory, configFileName, `{ "logLevel": "warn", "retention": 10 }`);
  write(directory, preferencesFileName, `{ "theme": "midnight" }`);

  const { store, messages } = startedStore(directory);

  assert.equal(store.current().config.logLevel, "warn");
  assert.deepEqual(messages, [
    `${configFileName}: unknown key "retention" is ignored`,
    `${preferencesFileName}: unknown key "theme" is ignored`,
  ]);
});

test("rereading the same content wakes nobody", () => {
  const directory = freshDirectory();
  write(directory, configFileName, `{ "logLevel": "debug" }`);

  const { store } = startedStore(directory);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  write(directory, configFileName, `{ "logLevel": "debug" }`);
  store.reload();

  assert.equal(notifications, 0);
});

test("an atomic replace is picked up twice in a row", async () => {
  const directory = freshDirectory();
  const { store } = startedStore(directory);

  const first = await applyAtomically(store, directory, configFileName, `{ "logLevel": "debug" }`);

  assert.equal(first.config.logLevel, "debug");

  // Вторая замена — та самая проверка, на которой наблюдатель за файлом молчит (docs/data-directory.md).
  const second = await applyAtomically(store, directory, configFileName, `{ "logLevel": "error" }`);

  assert.equal(second.config.logLevel, "error");
});

test("foreign files in the data directory raise nothing", async () => {
  const directory = freshDirectory();
  const { store } = startedStore(directory);

  // Сначала убеждаемся, что наблюдатель встал: иначе тишина ниже ничего не доказывает.
  await applyAtomically(store, directory, configFileName, `{ "logLevel": "debug" }`);

  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  write(directory, `${configFileName}.tmp`, `{ "logLevel": "warn" }`);
  write(directory, ".DS_Store", "junk");
  write(directory, "daemon.lock", `{ "pid": 1 }`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(notifications, 0);
  assert.equal(store.current().config.logLevel, "debug");
});

test("a written preference is in the snapshot when the call returns", () => {
  const directory = freshDirectory();
  const { store } = startedStore(directory);

  const outcome = store.writePluginPreferences("data:hello", {
    enabled: true,
    disabledContributions: ["hello.greeting"],
  });

  assert.deepEqual(outcome, { kind: "written" });
  assert.deepEqual(store.current().preferences.plugins["data:hello"], {
    enabled: true,
    disabledContributions: ["hello.greeting"],
  });
  assert.deepEqual(JSON.parse(readFileSync(join(directory, preferencesFileName), "utf8")), {
    plugins: { "data:hello": { enabled: true, disabledContributions: ["hello.greeting"] } },
  });
});

test("two config updates preserve both supplied fields", () => {
  const directory = freshDirectory();
  const { store } = startedStore(directory);

  assert.deepEqual(store.writeConfig({ logLevel: "debug" }), { kind: "written" });
  assert.deepEqual(store.writeConfig({ maxConcurrentTurns: 8 }), { kind: "written" });

  assert.deepEqual(store.current().config, {
    ...defaultConfig,
    logLevel: "debug",
    maxConcurrentTurns: 8,
  });
  assert.deepEqual(JSON.parse(readFileSync(join(directory, configFileName), "utf8")), {
    logLevel: "debug",
    maxConcurrentTurns: 8,
  });
});

test("a config update that contradicts the file on disk is refused instead of written", () => {
  const directory = freshDirectory();

  const consistent = {
    maxImageBytes: 1024,
    maxMessageImageBytes: 2048,
    maxSessionImageBytes: 4096,
  };

  write(directory, configFileName, JSON.stringify(consistent));

  const { store } = startedStore(directory);

  assert.equal(store.current().config.maxImageBytes, 1024);

  // Файл на диске непротиворечив, и само значение законно — неисполнимым становится их объединение.
  // Проверка обязана случиться **до** записи, иначе на диск ложится документ, который демон
  // отвергнет при следующем чтении, и настройки останутся нечитаемыми.
  const outcome = store.writeConfig({ maxImageBytes: 4096 });

  assert.equal(outcome.kind, "refused");
  assert.deepEqual(JSON.parse(readFileSync(join(directory, configFileName), "utf8")), consistent);
  assert.equal(store.current().config.maxImageBytes, 1024);
});

test("writing one plugin keeps what the file says about the others", () => {
  const directory = freshDirectory();

  write(
    directory,
    preferencesFileName,
    `{ "plugins": { "builtin:demo": { "enabled": false, "disabledContributions": [] } } }`,
  );

  const { store } = startedStore(directory);

  store.writePluginPreferences("data:hello", { enabled: true, disabledContributions: [] });

  assert.deepEqual(store.current().preferences.plugins, {
    "builtin:demo": { enabled: false, disabledContributions: [] },
    "data:hello": { enabled: true, disabledContributions: [] },
  });
});

test("writing one plugin keeps a key the schema does not know", () => {
  const directory = freshDirectory();

  write(directory, preferencesFileName, `{ "pinnedViews": ["plugins"], "plugins": {} }`);

  const { store } = startedStore(directory);

  assert.deepEqual(
    store.writePluginPreferences("data:hello", {
      enabled: true,
      disabledContributions: [],
    }),
    { kind: "written" },
  );

  // Ключ из более новой версии платформы или из чужой правки переживает запись (docs/data-directory.md): иначе
  // нажатие переключателя молча уносит настройку.
  assert.deepEqual(JSON.parse(readFileSync(join(directory, preferencesFileName), "utf8")), {
    pinnedViews: ["plugins"],
    plugins: { "data:hello": { enabled: true, disabledContributions: [] } },
  });
});

test("an unreadable preferences file is refused instead of overwritten", () => {
  const directory = freshDirectory();

  write(directory, preferencesFileName, "{ broken");

  const { store } = startedStore(directory);
  const outcome = store.writePluginPreferences("data:hello", {
    enabled: true,
    disabledContributions: [],
  });

  assert.equal(outcome.kind, "refused");
  assert.equal(readFileSync(join(directory, preferencesFileName), "utf8"), "{ broken");
});

// Права проверяются ядром, а root их не спрашивает: под ним директория без права записи пишется, и
// проверка стала бы ложно красной.
test(
  "a directory that refuses the write is reported, not thrown",
  { skip: process.getuid?.() === 0 },
  () => {
    const directory = freshDirectory();
    const { store } = startedStore(directory);

    chmodSync(directory, 0o555);

    try {
      const outcome = store.writeConfig({ ...defaultConfig, maxConcurrentTurns: 8 });

      assert.equal(outcome.kind, "failed");
      assert.match(
        outcome.kind === "failed" ? outcome.reason : "",
        /^config\.json was not written: /,
      );
    } finally {
      // Иначе не убрать рабочую директорию после прогона.
      chmodSync(directory, 0o755);
    }
  },
);

// Права проверяются ядром, а root их не спрашивает: под ним чтение прошло бы и проверка стала бы
// ложно зелёной.
test(
  "an existing file that refuses the read is reported, not thrown",
  { skip: process.getuid?.() === 0 },
  () => {
    const directory = freshDirectory();

    write(directory, configFileName, JSON.stringify(defaultConfig));

    const { store } = startedStore(directory);
    const path = join(directory, configFileName);

    chmodSync(path, 0o000);

    try {
      const outcome = store.writeConfig({ ...defaultConfig, maxConcurrentTurns: 8 });

      assert.equal(outcome.kind, "failed");
      assert.match(
        outcome.kind === "failed" ? outcome.reason : "",
        /^config\.json was not written: /,
      );
    } finally {
      chmodSync(path, 0o644);
    }
  },
);

test("the write leaves no temporary file behind", () => {
  const directory = freshDirectory();
  const { store } = startedStore(directory);

  store.writePluginPreferences("data:hello", { enabled: true, disabledContributions: [] });

  assert.deepEqual(readdirSync(directory), [preferencesFileName]);
});
