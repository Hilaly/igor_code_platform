import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createLogger, type Logger } from "../platform/public.ts";
import {
  createPluginWatcher,
  type ChangedPluginDirectory,
  type PluginWatcher,
} from "./plugin-watcher.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-plugin-watcher-"));
const opened: PluginWatcher[] = [];
let created = 0;

// Незакрытый наблюдатель держит цикл событий, и упавший тест превращается в зависший прогон.
after(() => {
  for (const watcher of opened) {
    watcher.close();
  }

  rmSync(workspace, { recursive: true, force: true });
});

const silent: Logger = createLogger({ source: "core", level: () => "error", write: () => {} });

function freshRoot(): string {
  created += 1;
  const directory = join(workspace, `root-${created}`);
  mkdirSync(join(directory, "hello", "src"), { recursive: true });
  writeFileSync(join(directory, "hello", "package.json"), "{}\n");
  writeFileSync(join(directory, "hello", "src", "worker.ts"), "export function activate() {}\n");

  // Плагин лежал тут до наблюдателя: иначе тест не отличит правку от перечисления поддерева,
  // которое приходит первой же пачкой (проверка 17).
  const anHourAgo = new Date(Date.now() - 3_600_000);
  utimesSync(join(directory, "hello", "package.json"), anHourAgo, anHourAgo);
  utimesSync(join(directory, "hello", "src", "worker.ts"), anHourAgo, anHourAgo);

  return directory;
}

type Started = {
  watcher: PluginWatcher;
  /** Ждёт вызова onChange; отсутствие вызова — тоже результат, поэтому таймаут отдельный. */
  nextChange: (timeoutMilliseconds?: number) => Promise<ChangedPluginDirectory[] | undefined>;
};

function started(root: string): Started {
  const pending: ChangedPluginDirectory[][] = [];
  let waiter: ((directories: ChangedPluginDirectory[]) => void) | undefined;

  const watcher = createPluginWatcher({
    roots: [{ source: "data", directory: root }],
    logger: silent,
    debounceMilliseconds: 20,
    onChange: (directories) => {
      if (waiter === undefined) {
        pending.push(directories);

        return;
      }

      const resolve = waiter;
      waiter = undefined;
      resolve(directories);
    },
  });

  watcher.start();
  opened.push(watcher);

  return {
    watcher,
    nextChange: (timeoutMilliseconds = 2_000) =>
      new Promise((resolve) => {
        const ready = pending.shift();

        if (ready !== undefined) {
          resolve(ready);

          return;
        }

        const timer = setTimeout(() => {
          waiter = undefined;
          resolve(undefined);
        }, timeoutMilliseconds);

        waiter = (directories) => {
          clearTimeout(timer);
          resolve(directories);
        };
      }),
  };
}

describe("createPluginWatcher", () => {
  it("reports the plugin folder whose sources changed", async () => {
    const root = freshRoot();
    const { watcher, nextChange } = started(root);

    // Запись повторяется, пока наблюдатель не отзовётся: иначе тест проверяет гонку с его
    // постановкой, а не поведение кода (runtime-checks.md, проверка 14).
    const change = await repeatUntilSeen(nextChange, () =>
      writeFileSync(join(root, "hello", "src", "worker.ts"), "export function activate() {}\n"),
    );

    assert.deepEqual(change, [{ directory: join(root, "hello"), fileResourcesChanged: false }]);

    watcher.close();
  });

  it("classifies changes anywhere below agents and skills as file-resource changes", async () => {
    const root = freshRoot();
    const references = join(root, "hello", "skills", "review", "references");
    mkdirSync(references, { recursive: true });
    const { watcher, nextChange } = started(root);

    const change = await repeatUntilSeen(nextChange, () =>
      writeFileSync(join(references, "checklist.md"), `${Date.now()}\n`),
    );

    assert.deepEqual(change, [{ directory: join(root, "hello"), fileResourcesChanged: true }]);
    watcher.close();
  });

  it("names no plugin when the installer works inside node_modules", async () => {
    const root = freshRoot();
    mkdirSync(join(root, "hello", "node_modules", "left"), { recursive: true });

    const { watcher, nextChange } = started(root);

    writeFileSync(join(root, "hello", "node_modules", "left", "index.js"), "module.exports = 1;\n");
    writeFileSync(join(root, "hello", "package-lock.json"), "{}\n");

    // Пачка на всё поддерево при первом событии (проверка 17) не должна выглядеть правкой плагина:
    // иначе установка зависимостей перезагружала бы плагин, а перезагрузка звала бы установку.
    const change = await nextChange(400);

    assert.deepEqual(change ?? [], []);

    watcher.close();
  });

  it("reports a new plugin folder without naming a plugin", async () => {
    const root = freshRoot();
    const { watcher, nextChange } = started(root);

    // Каждая попытка создаёт новую папку: повторный `mkdir` идемпотентен и события не даёт, а
    // первое событие могло уйти в окно, пока наблюдатель ещё вставал (проверка 14).
    let attempt = 0;

    const change = await repeatUntilSeen(nextChange, () => {
      attempt += 1;
      mkdirSync(join(root, `notes-${attempt}`), { recursive: true });
    });

    assert.deepEqual(change, []);

    watcher.close();
  });

  it("tolerates a source root that does not exist", () => {
    const watcher = createPluginWatcher({
      roots: [{ source: "builtin", directory: join(workspace, "never-created") }],
      logger: silent,
      onChange: () => {
        throw new Error("a missing root cannot change");
      },
    });

    watcher.start();
    watcher.close();
  });

  it("stops reporting after close", async () => {
    const root = freshRoot();
    const { watcher, nextChange } = started(root);
    watcher.close();

    writeFileSync(join(root, "hello", "src", "worker.ts"), "export const changed = true;\n");

    assert.equal(await nextChange(300), undefined);
  });
});

async function repeatUntilSeen(
  nextChange: Started["nextChange"],
  write: () => void,
): Promise<ChangedPluginDirectory[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    write();

    const change = await nextChange(200);

    if (change !== undefined) {
      return change;
    }
  }

  throw new Error("the watcher never reported the change");
}
