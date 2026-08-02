import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function started(roots: StandaloneResourceRoot[]) {
  const pending: number[] = [];
  let waiter: (() => void) | undefined;
  const watcher = createFileResourceWatcher({
    roots,
    logger,
    debounceMilliseconds: 20,
    onChange: () => {
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
    const { watcher, nextChange } = started([root(directory)]);

    let attempt = 0;
    await repeatUntilSeen(nextChange, () => {
      attempt += 1;
      mkdirSync(join(directory, `definition-${attempt}`), { recursive: true });
    });
    watcher.close();
  });

  it("reports create, change, delete, and sibling resource events", async () => {
    const directory = join(workspace, `existing-${sequence++}`);
    const definition = join(directory, "helper");
    mkdirSync(definition, { recursive: true });
    const entry = join(definition, "AGENT.md");
    const sibling = join(definition, "reference.md");
    const { watcher, nextChange } = started([root(directory)]);

    await repeatUntilSeen(nextChange, () => writeFileSync(entry, `created ${Date.now()}\n`));
    await repeatUntilSeen(nextChange, () => writeFileSync(entry, `changed ${Date.now()}\n`));
    await repeatUntilSeen(nextChange, () => writeFileSync(sibling, `sibling ${Date.now()}\n`));
    await repeatUntilSeen(nextChange, () => rmSync(entry, { force: true }));
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
