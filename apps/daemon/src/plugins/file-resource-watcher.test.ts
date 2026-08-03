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
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createLogger } from "../platform/public.ts";
import { createFileResourceWatcher, type FileResourceWatcher } from "./file-resource-watcher.ts";
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
) {
  const pending: number[] = [];
  let waiter: (() => void) | undefined;
  let changeCount = 0;
  const countWaiters: Array<{ target: number; resolve: () => void }> = [];
  const watcher = createFileResourceWatcher({
    roots,
    logger,
    debounceMilliseconds: 20,
    ...(inspectPath === undefined ? {} : { inspectPath }),
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

async function repeatUntilSeen(nextChange: () => Promise<boolean>, change: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    change();
    if (await nextChange()) return;
  }
  throw new Error("the watcher never reported the change");
}

describe("createFileResourceWatcher", () => {
  it("reports an absent root when its path appears below an existing parent", async () => {
    const parent = join(workspace, `missing-${sequence++}`);
    mkdirSync(parent);
    const directory = join(parent, ".sovereign", "agents");
    const startedWatcher = started([root(directory)]);
    const { watcher, nextChange } = startedWatcher;

    let attempt = 0;
    await repeatUntilSeen(nextChange, () => {
      attempt += 1;
      mkdirSync(join(directory, `definition-${attempt}`), { recursive: true });
    });
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

  it("reports create, change, delete, and sibling resource events", async () => {
    const directory = join(workspace, `existing-${sequence++}`);
    const definition = join(directory, "helper");
    mkdirSync(definition, { recursive: true });
    const entry = join(definition, "AGENT.md");
    const sibling = join(definition, "reference.md");
    const startedWatcher = started([root(directory)]);
    const { watcher, nextChange } = startedWatcher;

    await repeatUntilSeen(nextChange, () => writeFileSync(entry, `created ${Date.now()}\n`));
    await repeatUntilSeen(nextChange, () => writeFileSync(entry, `changed ${Date.now()}\n`));
    await repeatUntilSeen(nextChange, () => writeFileSync(sibling, `sibling ${Date.now()}\n`));
    await repeatUntilSeen(nextChange, () => rmSync(entry, { force: true }));
    watcher.close();
  });

  it("reports an old definition tree moved into an existing root", async () => {
    const directory = join(workspace, `moved-root-${sequence++}`);
    const prepared = join(workspace, `prepared-${sequence++}`);
    mkdirSync(directory);
    mkdirSync(join(prepared, "references"), { recursive: true });
    writeFileSync(join(prepared, "AGENT.md"), "old definition\n");
    writeFileSync(join(prepared, "references", "guide.md"), "old resource\n");
    const anHourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(join(prepared, "AGENT.md"), anHourAgo, anHourAgo);
    utimesSync(join(prepared, "references", "guide.md"), anHourAgo, anHourAgo);
    utimesSync(join(prepared, "references"), anHourAgo, anHourAgo);
    utimesSync(prepared, anHourAgo, anHourAgo);
    const startedWatcher = started([root(directory)]);
    const { watcher, nextChange } = startedWatcher;
    const moved = join(directory, "moved");

    // Establish that the recursive watcher is active before issuing the one-shot rename.
    writeFileSync(join(directory, "watcher-ready.md"), "ready\n");
    assert.equal(await nextChange(1_000), true);
    const callbacksAfterReady = startedWatcher.changeCount;

    // First prove the original one-shot rename event. Only after that callback (including debounce,
    // rearm, and onChange) completes may a later mutation prove the moved tree remains watched.
    renameSync(prepared, moved);
    await startedWatcher.waitForChangeCount(callbacksAfterReady + 1);
    const callbacksAfterRename = startedWatcher.changeCount;
    writeFileSync(join(moved, "references", "guide.md"), `old resource ${Date.now()}\n`);
    await startedWatcher.waitForChangeCount(callbacksAfterRename + 1);
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
