import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  acquireInstanceLock,
  InstanceLockError,
  lockFileName,
  type InstanceLockRecord,
} from "./instance-lock.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-instance-lock-"));
let directoryCounter = 0;

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function freshDirectory(): string {
  directoryCounter += 1;

  return mkdtempSync(join(workspace, `case-${directoryCounter}-`));
}

function writeLockFile(directory: string, record: Partial<InstanceLockRecord> | string): void {
  const content = typeof record === "string" ? record : JSON.stringify(record);

  writeFileSync(join(directory, lockFileName), content);
}

function readLockFile(directory: string): InstanceLockRecord {
  return JSON.parse(readFileSync(join(directory, lockFileName), "utf8")) as InstanceLockRecord;
}

const neverAlive = () => false;
const alwaysAlive = () => true;

test("acquiring writes the pid, the port and the host", () => {
  const directory = freshDirectory();

  const lock = acquireInstanceLock({
    directory,
    port: 8899,
    now: new Date("2026-07-26T10:00:00.000Z"),
  });

  assert.deepEqual(readLockFile(directory), {
    pid: process.pid,
    startedAt: "2026-07-26T10:00:00.000Z",
    hostname: hostname(),
    port: 8899,
  });
  assert.equal(lock.record.pid, process.pid);
});

test("a lock held by a live process is refused with its pid and port", () => {
  const directory = freshDirectory();
  writeLockFile(directory, {
    pid: 4242,
    startedAt: "2026-07-26T10:00:00.000Z",
    hostname: hostname(),
    port: 8787,
  });

  assert.throws(
    () => acquireInstanceLock({ directory, port: 8899, isProcessAlive: alwaysAlive }),
    (error: unknown) =>
      error instanceof InstanceLockError &&
      error.message.includes("4242") &&
      error.message.includes("8787"),
  );
});

test("a stale lock is taken over", () => {
  const directory = freshDirectory();
  writeLockFile(directory, {
    pid: 4242,
    startedAt: "2026-07-26T10:00:00.000Z",
    hostname: hostname(),
    port: 8787,
  });

  acquireInstanceLock({ directory, port: 8899, isProcessAlive: neverAlive });

  assert.deepEqual(readLockFile(directory).pid, process.pid);
  assert.equal(readLockFile(directory).port, 8899);
});

test("a lock from another host is refused even when the pid looks dead", () => {
  const directory = freshDirectory();
  writeLockFile(directory, {
    pid: 4242,
    startedAt: "2026-07-26T10:00:00.000Z",
    hostname: "another-machine",
    port: 8787,
  });

  assert.throws(
    () => acquireInstanceLock({ directory, port: 8899, isProcessAlive: neverAlive }),
    (error: unknown) =>
      error instanceof InstanceLockError && error.message.includes("another-machine"),
  );
});

test("an unreadable lock is refused and names the manual fix", () => {
  const directory = freshDirectory();
  writeLockFile(directory, "{ not json");

  assert.throws(
    () => acquireInstanceLock({ directory, port: 8899, isProcessAlive: neverAlive }),
    (error: unknown) => error instanceof InstanceLockError && /remove it/.test(error.message),
  );
});

test("an incomplete lock is refused: the previous daemon died mid-write", () => {
  const directory = freshDirectory();
  writeLockFile(directory, { pid: 4242 });

  assert.throws(
    () => acquireInstanceLock({ directory, port: 8899, isProcessAlive: neverAlive }),
    InstanceLockError,
  );
});

test("release removes our own lock file", () => {
  const directory = freshDirectory();
  const lock = acquireInstanceLock({ directory, port: 8899 });

  lock.release();

  assert.equal(existsSync(lock.path), false);
});

test("release keeps a lock file that belongs to someone else", () => {
  const directory = freshDirectory();
  const lock = acquireInstanceLock({ directory, port: 8899 });

  // Пока мы работали, лок перезахватили: наш release не имеет права снимать чужой.
  writeLockFile(directory, {
    pid: process.pid + 1,
    startedAt: "2026-07-26T10:00:00.000Z",
    hostname: hostname(),
    port: 8787,
  });
  lock.release();

  assert.equal(readLockFile(directory).port, 8787);
});
