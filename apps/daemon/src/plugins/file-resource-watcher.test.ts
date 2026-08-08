import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  watch,
  type FSWatcher,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, describe, it } from "node:test";

import { createLogger, type Logger } from "../platform/public.ts";
import {
  createFileResourceWatcher,
  type CreateFileResourceWatcherOptions,
  type FileResourceWatcher,
} from "./file-resource-watcher.ts";
import type { StandaloneResourceRoot } from "./file-resource-roots.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-file-resource-watcher-"));
const opened: FileResourceWatcher[] = [];
let sequence = 0;

after(() => {
  for (const watcher of opened) watcher.close();
  rmSync(workspace, { recursive: true, force: true });
});

const logger = createLogger({ source: "core", level: () => "error", write: () => {} });

function root(directory: string, key = "data:agents"): StandaloneResourceRoot {
  return {
    key,
    source: "sovereign",
    scope: "user",
    kind: "agent",
    precedence: 100,
    directory,
  };
}

function started(
  roots: StandaloneResourceRoot[],
  inspectPath?: (path: string) => Stats | undefined,
  watchDirectory?: CreateFileResourceWatcherOptions["watchDirectory"],
  debounce?: Pick<CreateFileResourceWatcherOptions, "scheduleDebounce" | "cancelDebounce">,
  watcherLogger: Logger = logger,
  onWatchArmed?: (directory: string, recursive: boolean) => void,
) {
  const pending: number[] = [];
  let waiter: (() => void) | undefined;
  let changeCount = 0;
  const watchFactory: CreateFileResourceWatcherOptions["watchDirectory"] = (
    directory,
    recursive,
    listener,
  ) => {
    const watcher =
      watchDirectory !== undefined
        ? watchDirectory(directory, recursive, listener)
        : watch(directory, { recursive }, listener);
    onWatchArmed?.(directory, recursive);
    return watcher;
  };
  const countWaiters: Array<{ target: number; resolve: () => void }> = [];
  const watcher = createFileResourceWatcher({
    roots,
    logger: watcherLogger,
    debounceMilliseconds: 20,
    ...(inspectPath === undefined ? {} : { inspectPath }),
    watchDirectory: watchFactory,
    ...debounce,
    onChange: () => {
      changeCount += 1;
      for (let index = countWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = countWaiters[index];
        if (waiter === undefined) continue;
        if (changeCount < waiter.target) continue;
        waiter.resolve();
        countWaiters.splice(index, 1);
      }
      if (waiter === undefined) pending.push(1);
      else {
        const resolve = waiter;
        waiter = undefined;
        resolve();
      }
    },
  });
  watcher.start();
  opened.push(watcher);

  return {
    watcher,
    get changeCount() {
      return changeCount;
    },
    waitForChangeCount: (target: number, timeoutMilliseconds = 1_000): Promise<void> =>
      new Promise((resolve, reject) => {
        if (changeCount >= target) {
          resolve();
          return;
        }
        const finish = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const index = countWaiters.findIndex((entry) => entry.resolve === finish);
          if (index >= 0) countWaiters.splice(index, 1);
          reject(new Error(`watcher callback count stayed below ${target}`));
        }, timeoutMilliseconds);
        countWaiters.push({ target, resolve: finish });
      }),
    nextChange: (timeoutMilliseconds = 250): Promise<boolean> =>
      new Promise((resolve) => {
        if (pending.shift() !== undefined) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => {
          waiter = undefined;
          resolve(false);
        }, timeoutMilliseconds);
        waiter = () => {
          clearTimeout(timer);
          resolve(true);
        };
      }),
  };
}

function injectedWatcher(
  directory: string,
  inspectPath: (path: string) => Stats | undefined = (path) =>
    lstatSync(path, { throwIfNoEntry: false }),
) {
  const listeners: Array<(event: string, name: string | Buffer | null) => void> = [];
  const scheduled: Array<() => void> = [];
  const errors: string[] = [];
  const watcherLogger = createLogger({
    source: "core",
    level: () => "error",
    write: (record) => errors.push(record.message),
  });
  let errorListeners = 0;
  const startedWatcher = started(
    [root(directory)],
    inspectPath,
    (_watchedDirectory, _recursive, listener) => {
      listeners.push(listener);
      const fakeWatcher = {
        on: (event: string) => {
          if (event === "error") errorListeners += 1;
          return fakeWatcher;
        },
        close: () => undefined,
      };
      return fakeWatcher as unknown as FSWatcher;
    },
    {
      scheduleDebounce: (callback) => {
        scheduled.push(callback);
        return { unref: () => undefined } as unknown as NodeJS.Timeout;
      },
      cancelDebounce: () => undefined,
    },
    watcherLogger,
  );

  return {
    watcher: startedWatcher.watcher,
    get changeCount() {
      return startedWatcher.changeCount;
    },
    waitForChangeCount: startedWatcher.waitForChangeCount,
    errors,
    get errorListeners() {
      return errorListeners;
    },
    scheduled,
    flush: () => {
      const callback = scheduled.shift();
      if (callback === undefined) throw new Error("no watcher callback is scheduled");
      callback();
    },
    emit: (event: string, name: string) => {
      const listener = listeners.at(-1);
      if (listener === undefined) throw new Error("watcher listener is not armed");
      listener(event, name);
    },
  };
}

async function repeatUntilSeen(nextChange: () => Promise<boolean>, change: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    change();
    if (await nextChange()) return;
  }
  throw new Error("the watcher never reported the change");
}

async function repeatUntilChangeCount(
  startedWatcher: { waitForChangeCount: (target: number, timeout?: number) => Promise<void> },
  target: number,
  change: () => void,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    change();
    try {
      await startedWatcher.waitForChangeCount(target, 200);
      return;
    } catch (cause) {
      if (!(cause instanceof Error) || !cause.message.startsWith("watcher callback count stayed")) {
        throw cause;
      }
    }
  }
  throw new Error(`watcher callback count stayed below ${target}`);
}

describe("createFileResourceWatcher", () => {
  it("reports an absent root when its path appears below an existing parent", async () => {
    const parent = join(workspace, `missing-${sequence++}`);
    mkdirSync(parent);
    const directory = join(parent, ".sovereign", "agents");
    let watchArmed = false;
    const startedWatcher = started(
      [root(directory)],
      undefined,
      undefined,
      undefined,
      logger,
      (watchedDirectory, recursive) => {
        if (watchedDirectory === parent && !recursive) watchArmed = true;
      },
    );
    const { watcher } = startedWatcher;

    assert.equal(watchArmed, true);
    let appearanceAttempt = 0;
    await repeatUntilChangeCount(startedWatcher, 1, () => {
      appearanceAttempt += 1;
      rmSync(join(parent, ".sovereign"), { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `definition-${appearanceAttempt}.md`), "definition\n");
    });
    assert.equal(startedWatcher.changeCount, 1);
    watcher.close();
  });

  it("ignores unrelated siblings while an absent root is watched", async () => {
    const parent = join(workspace, `unrelated-${sequence++}`);
    mkdirSync(parent);
    const directory = join(parent, ".sovereign", "agents");
    const { watcher, nextChange } = started([root(directory)]);

    mkdirSync(join(parent, "unrelated-sibling"));
    assert.equal(await nextChange(150), false);

    mkdirSync(directory, { recursive: true });
    assert.equal(await nextChange(1_000), true);
    watcher.close();
  });

  it("accepts a coalesced event only after the complete absent root exists", () => {
    const parent = join(workspace, `injected-missing-${sequence++}`);
    mkdirSync(parent);
    const sovereignDirectory = join(parent, ".sovereign");
    const directory = join(sovereignDirectory, "agents");
    const startedWatcher = injectedWatcher(directory);
    assert.deepEqual(startedWatcher.errors, []);
    assert.equal(startedWatcher.errorListeners, 1);

    mkdirSync(sovereignDirectory);
    startedWatcher.emit("rename", ".sovereign");
    assert.equal(startedWatcher.scheduled.length, 0);
    assert.equal(startedWatcher.changeCount, 0);

    mkdirSync(join(parent, "unrelated-sibling"));
    startedWatcher.emit("rename", "unrelated-sibling");
    assert.equal(startedWatcher.scheduled.length, 0);
    assert.equal(startedWatcher.changeCount, 0);

    mkdirSync(directory);
    startedWatcher.emit("change", "unrelated-after-root");
    assert.equal(startedWatcher.scheduled.length, 0);
    assert.equal(startedWatcher.changeCount, 0);

    startedWatcher.emit("change", basename(parent));
    assert.equal(startedWatcher.scheduled.length, 1);
    startedWatcher.flush();
    assert.equal(startedWatcher.changeCount, 1);
    startedWatcher.watcher.close();
  });

  it("rejects file and symlink roots before accepting an absent real directory", () => {
    const parent = join(workspace, `injected-root-kind-${sequence++}`);
    const sovereignDirectory = join(parent, ".sovereign");
    const directory = join(sovereignDirectory, "agents");
    const external = join(workspace, `injected-root-target-${sequence++}`);
    mkdirSync(sovereignDirectory, { recursive: true });
    mkdirSync(external);
    const startedWatcher = injectedWatcher(directory);

    writeFileSync(directory, "not a directory\n");
    startedWatcher.emit("rename", ".sovereign");
    assert.equal(startedWatcher.scheduled.length, 0);

    rmSync(directory);
    symlinkSync(external, directory);
    startedWatcher.emit("rename", basename(parent));
    assert.equal(startedWatcher.scheduled.length, 0);

    rmSync(directory);
    mkdirSync(directory);
    startedWatcher.emit("rename", "unrelated-after-root");
    assert.equal(startedWatcher.scheduled.length, 0);
    startedWatcher.emit("rename", ".sovereign");
    assert.equal(startedWatcher.scheduled.length, 1);
    startedWatcher.flush();
    assert.equal(startedWatcher.changeCount, 1);
    assert.deepEqual(startedWatcher.errors, []);
    startedWatcher.watcher.close();
  });

  it("logs and ignores an absent-root inspection race", () => {
    const parent = join(workspace, `injected-inspection-${sequence++}`);
    mkdirSync(parent);
    const directory = join(parent, ".sovereign", "agents");
    let inspectionFails = false;
    const startedWatcher = injectedWatcher(directory, (path) => {
      if (inspectionFails && path === directory) throw new Error("root inspection raced");
      return lstatSync(path, { throwIfNoEntry: false });
    });

    inspectionFails = true;
    startedWatcher.emit("rename", ".sovereign");

    assert.equal(startedWatcher.scheduled.length, 0);
    assert.equal(startedWatcher.changeCount, 0);
    assert.deepEqual(startedWatcher.errors, ["inspecting a standalone file resource root failed"]);
    startedWatcher.watcher.close();
  });

  it("accepts the expected segment event once the complete absent root exists", () => {
    const parent = join(workspace, `injected-expected-${sequence++}`);
    mkdirSync(parent);
    const directory = join(parent, ".sovereign", "agents");
    const startedWatcher = injectedWatcher(directory);

    mkdirSync(directory, { recursive: true });
    startedWatcher.emit("rename", ".sovereign");
    assert.equal(startedWatcher.scheduled.length, 1);
    startedWatcher.flush();
    assert.equal(startedWatcher.changeCount, 1);
    startedWatcher.watcher.close();
  });

  it("reports create, change, delete, and sibling resource events", async () => {
    const directory = join(workspace, `existing-${sequence++}`);
    const definition = join(directory, "helper");
    mkdirSync(definition, { recursive: true });
    const entry = join(definition, "AGENT.md");
    const sibling = join(definition, "reference.md");
    const startedWatcher = started([root(directory)]);
    const { watcher } = startedWatcher;

    await repeatUntilChangeCount(startedWatcher, 1, () =>
      writeFileSync(entry, `created ${Date.now()}\n`),
    );
    await repeatUntilChangeCount(startedWatcher, 2, () =>
      writeFileSync(entry, `changed ${Date.now()}\n`),
    );
    await repeatUntilChangeCount(startedWatcher, 3, () =>
      writeFileSync(sibling, `sibling ${Date.now()}\n`),
    );
    let deleteAttempt = 0;
    while (startedWatcher.changeCount < 4 && deleteAttempt < 20) {
      deleteAttempt += 1;
      if (lstatSync(entry, { throwIfNoEntry: false }) === undefined) {
        const recreateTarget = startedWatcher.changeCount + 1;
        writeFileSync(entry, `recreated before delete ${deleteAttempt}\n`);
        await startedWatcher.waitForChangeCount(recreateTarget, 1_000);
      }
      const deleteTarget = startedWatcher.changeCount + 1;
      rmSync(entry);
      try {
        await startedWatcher.waitForChangeCount(deleteTarget, 200);
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          !cause.message.startsWith("watcher callback count stayed")
        ) {
          throw cause;
        }
      }
    }
    assert.ok(startedWatcher.changeCount >= 4);
    watcher.close();
  });

  it("keeps the same watcher while the watched directory stays the right one", async () => {
    const directory = join(workspace, `stable-arm-${sequence++}`);
    const definition = join(directory, "helper");
    mkdirSync(definition, { recursive: true });
    const armed: Array<{ directory: string; recursive: boolean }> = [];
    const startedWatcher = started(
      [root(directory)],
      undefined,
      undefined,
      undefined,
      logger,
      (watchedDirectory, recursive) => armed.push({ directory: watchedDirectory, recursive }),
    );

    assert.deepEqual(armed, [{ directory, recursive: true }]);

    // Пересоздание рекурсивного наблюдателя на macOS теряет события, случившиеся в момент
    // перевооружения, а восстановиться нечем: повторное удаление уже удалённого файла событий не
    // рождает. Поэтому наблюдатель обязан пережить изменение внутри root, а не пересобираться.
    await repeatUntilChangeCount(startedWatcher, 1, () =>
      writeFileSync(join(definition, "AGENT.md"), `created ${Date.now()}\n`),
    );
    await repeatUntilChangeCount(startedWatcher, 2, () =>
      writeFileSync(join(definition, "AGENT.md"), `changed ${Date.now()}\n`),
    );

    assert.deepEqual(armed, [{ directory, recursive: true }]);
    startedWatcher.watcher.close();
  });

  it("moves from the parent to the root itself once the root appears", async () => {
    const parent = join(workspace, `arm-switch-${sequence++}`);
    mkdirSync(parent);
    const directory = join(parent, ".sovereign", "agents");
    const armed: Array<{ directory: string; recursive: boolean }> = [];
    const startedWatcher = started(
      [root(directory)],
      undefined,
      undefined,
      undefined,
      logger,
      (watchedDirectory, recursive) => armed.push({ directory: watchedDirectory, recursive }),
    );

    assert.deepEqual(armed, [{ directory: parent, recursive: false }]);

    let attempt = 0;
    await repeatUntilChangeCount(startedWatcher, 1, () => {
      attempt += 1;
      rmSync(join(parent, ".sovereign"), { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `definition-${attempt}.md`), "definition\n");
    });

    assert.deepEqual(armed.at(-1), { directory, recursive: true });
    startedWatcher.watcher.close();
  });

  it("reports an old definition tree moved into an existing root", async () => {
    const directory = join(workspace, `moved-root-${sequence++}`);
    mkdirSync(directory);
    const startedWatcher = started([root(directory)]);
    const { watcher } = startedWatcher;

    const readyBaseline = startedWatcher.changeCount;
    // Establish that the recursive watcher is active before issuing the one-shot rename.
    let readyAttempt = 0;
    await repeatUntilChangeCount(startedWatcher, readyBaseline + 1, () => {
      readyAttempt += 1;
      writeFileSync(join(directory, "watcher-ready.md"), `ready ${readyAttempt}\n`);
    });
    assert.equal(startedWatcher.changeCount, readyBaseline + 1);
    const callbacksAfterReady = startedWatcher.changeCount;

    // Every attempt is a real rename of a distinct tree whose mtimes predate the watcher. Native
    // recursive watchers can lose a one-shot event under full-suite load, so retry the observable
    // operation itself rather than mutating below a tree the current watcher may not have seen.
    let moved: string | undefined;
    let moveAttempt = 0;
    await repeatUntilChangeCount(startedWatcher, callbacksAfterReady + 1, () => {
      moveAttempt += 1;
      const prepared = join(workspace, `prepared-${sequence++}`);
      const nextMoved = join(directory, `moved-${moveAttempt}`);
      mkdirSync(join(prepared, "references"), { recursive: true });
      writeFileSync(join(prepared, "AGENT.md"), `old definition ${moveAttempt}\n`);
      writeFileSync(join(prepared, "references", "guide.md"), `old resource ${moveAttempt}\n`);
      const anHourAgo = new Date(Date.now() - 3_600_000);
      utimesSync(join(prepared, "AGENT.md"), anHourAgo, anHourAgo);
      utimesSync(join(prepared, "references", "guide.md"), anHourAgo, anHourAgo);
      utimesSync(join(prepared, "references"), anHourAgo, anHourAgo);
      utimesSync(prepared, anHourAgo, anHourAgo);
      renameSync(prepared, nextMoved);
      moved = nextMoved;
    });
    assert.equal(startedWatcher.changeCount, callbacksAfterReady + 1);
    if (moved === undefined) throw new Error("no old definition tree was moved");
    const watchedMoved = moved;
    const callbacksAfterRename = startedWatcher.changeCount;
    let movedMutationAttempt = 0;
    await repeatUntilChangeCount(startedWatcher, callbacksAfterRename + 1, () => {
      movedMutationAttempt += 1;
      writeFileSync(
        join(watchedMoved, "references", "guide.md"),
        `old resource ${movedMutationAttempt}\n`,
      );
    });
    assert.equal(startedWatcher.changeCount, callbacksAfterRename + 1);
    watcher.close();
  });

  it("rescans when filesystem inspection races with a watcher callback", async () => {
    const directory = join(workspace, `inspection-race-${sequence++}`);
    mkdirSync(directory);
    let inspections = 0;
    const { watcher, nextChange } = started([root(directory)], (path) => {
      inspections += 1;
      if (inspections > 1) {
        const cause = new Error("the path became unreadable") as NodeJS.ErrnoException;
        cause.code = "EACCES";
        throw cause;
      }
      return lstatSync(path, { throwIfNoEntry: false });
    });

    await repeatUntilSeen(nextChange, () =>
      writeFileSync(join(directory, "raced.md"), `${Date.now()}\n`),
    );
    assert.ok(inspections > 1);
    watcher.close();
  });

  it("reports a symlink itself but never watches its external target", async () => {
    const directory = join(workspace, `symlink-root-${sequence++}`);
    const external = join(workspace, `external-${sequence++}`);
    mkdirSync(directory, { recursive: true });
    mkdirSync(external, { recursive: true });
    const { watcher, nextChange } = started([root(directory)]);

    await repeatUntilSeen(nextChange, () => {
      try {
        symlinkSync(external, join(directory, `linked-${Date.now()}`));
      } catch (cause) {
        if (!(cause instanceof Error) || (cause as { code?: unknown }).code !== "EEXIST")
          throw cause;
      }
    });
    writeFileSync(join(external, "AGENT.md"), `outside ${Date.now()}\n`);
    assert.equal(await nextChange(350), false);
    watcher.close();
  });

  it("rearms from an old project root to a new one", async () => {
    const oldRoot = join(workspace, `old-${sequence++}`);
    const newRoot = join(workspace, `new-${sequence++}`);
    mkdirSync(oldRoot);
    mkdirSync(newRoot);
    const { watcher, nextChange } = started([root(oldRoot, "project:old:agents:sovereign")]);
    watcher.rearm([root(newRoot, "project:new:agents:sovereign")]);

    writeFileSync(join(oldRoot, "ignored.md"), "old\n");
    assert.equal(await nextChange(350), false);
    await repeatUntilSeen(nextChange, () =>
      writeFileSync(join(newRoot, "noticed.md"), `${Date.now()}\n`),
    );
    watcher.close();
  });

  it("close removes watchers and a pending debounce timer", async () => {
    const directory = join(workspace, `closed-${sequence++}`);
    mkdirSync(directory);
    const { watcher, nextChange } = started([root(directory)]);
    writeFileSync(join(directory, "queued.md"), "queued\n");
    watcher.close();

    assert.equal(await nextChange(350), false);
    writeFileSync(join(directory, "later.md"), "later\n");
    assert.equal(await nextChange(350), false);
  });
});
