/**
 * Единственность экземпляра (docs/data-directory.md). Делимый ресурс — директория данных, а не порт, поэтому
 * защищается она: `daemon.lock` внутри неё создаётся атомарно (`O_CREAT|O_EXCL` за `open(path, "wx")`)
 * — это исключает гонку двух одновременных стартов средствами ядра.
 */

import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export const lockFileName = "daemon.lock";

export type InstanceLockRecord = {
  pid: number;
  /** Момент захвата, ISO 8601. */
  startedAt: string;
  hostname: string;
  port: number;
};

export type InstanceLock = {
  path: string;
  record: InstanceLockRecord;
  /** Удаляет файл, только если в нём наш `pid`: чужой лок мы не снимаем. */
  release: () => void;
};

/** Отказ старта, а не сбой: сообщение печатается пользователю без стека. */
export class InstanceLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceLockError";
  }
}

export type AcquireInstanceLockOptions = {
  directory: string;
  port: number;
  now?: Date;
  /** Внедряется тестом: путь протухшего лока иначе не проверить. */
  isProcessAlive?: (pid: number) => boolean;
};

export function acquireInstanceLock(options: AcquireInstanceLockOptions): InstanceLock {
  const path = join(options.directory, lockFileName);
  const isAlive = options.isProcessAlive ?? isProcessAlive;
  const record: InstanceLockRecord = {
    pid: process.pid,
    startedAt: (options.now ?? new Date()).toISOString(),
    hostname: hostname(),
    port: options.port,
  };

  if (createLockFile(path, record)) {
    return { path, record, release: () => releaseLockFile(path, record.pid) };
  }

  const existing = readLockFile(path);

  if (existing.hostname !== record.hostname) {
    throw new InstanceLockError(
      `The data directory is locked by ${existing.hostname} (pid ${existing.pid}, port ${existing.port}). ` +
        `A process on another machine cannot be checked from here — see ${path}.`,
    );
  }

  if (isAlive(existing.pid)) {
    throw new InstanceLockError(
      `Another daemon already owns this data directory: pid ${existing.pid}, port ${existing.port}.`,
    );
  }

  // Лок протух после kill -9 или падения машины. Повторная попытка ровно одна: иначе два
  // одновременно стартующих демона по очереди сносили бы лок друг друга (docs/data-directory.md).
  unlinkSync(path);

  if (!createLockFile(path, record)) {
    throw new InstanceLockError(
      `The stale lock ${path} was replaced by another daemon starting at the same moment.`,
    );
  }

  return { path, record, release: () => releaseLockFile(path, record.pid) };
}

function createLockFile(path: string, record: InstanceLockRecord): boolean {
  let descriptor: number;

  try {
    descriptor = openSync(path, "wx");
  } catch (cause) {
    if (hasErrorCode(cause, "EEXIST")) {
      return false;
    }

    throw cause;
  }

  try {
    writeSync(descriptor, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }

  return true;
}

/**
 * Случай, которого docs/data-directory.md не описал: файл есть, но прочитать его нечем — демон умер между
 * созданием и записью, или файл испортили. Владельца проверить нечем, поэтому отказ с указанием
 * ручного лечения: угадывать здесь дороже, чем два демона на одних данных.
 */
function readLockFile(path: string): InstanceLockRecord {
  const refuse = (reason: string): never => {
    throw new InstanceLockError(
      `The lock file ${path} ${reason}. If no daemon is running, remove it and start again.`,
    );
  };

  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (hasErrorCode(cause, "ENOENT")) {
      return refuse("disappeared while it was being read");
    }

    throw cause;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse("is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    return refuse("does not contain an object");
  }

  const candidate = parsed as Partial<InstanceLockRecord>;

  if (
    !Number.isInteger(candidate.pid) ||
    typeof candidate.hostname !== "string" ||
    typeof candidate.startedAt !== "string" ||
    !Number.isInteger(candidate.port)
  ) {
    return refuse("is incomplete");
  }

  return candidate as InstanceLockRecord;
}

function releaseLockFile(path: string, pid: number): void {
  let owner: InstanceLockRecord;

  try {
    owner = readLockFile(path);
  } catch (cause) {
    // Чужой или нечитаемый файл при завершении не наш: снять его мы всё равно не имеем права,
    // а падать в обработчике сигнала не за что.
    if (cause instanceof InstanceLockError) {
      return;
    }

    throw cause;
  }

  if (owner.pid !== pid) {
    return;
  }

  unlinkSync(path);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (cause) {
    if (hasErrorCode(cause, "ESRCH")) {
      return false;
    }

    // EPERM означает, что процесс есть, но принадлежит другому пользователю, — то есть жив.
    if (hasErrorCode(cause, "EPERM")) {
      return true;
    }

    throw cause;
  }
}

function hasErrorCode(value: unknown, code: string): boolean {
  return value instanceof Error && (value as { code?: unknown }).code === code;
}
