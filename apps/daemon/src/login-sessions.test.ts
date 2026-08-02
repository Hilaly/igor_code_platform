import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";

import { createLogger } from "./platform/public.ts";
import {
  createLoginSessionStore,
  loginSessionsFileName,
  sessionLifetimeMilliseconds,
  type LoginSessionStore,
} from "./login-sessions.ts";

const directories: string[] = [];
const stores: LoginSessionStore[] = [];

after(() => {
  for (const store of stores) {
    store.stop();
  }

  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type Harness = {
  store: LoginSessionStore;
  directory: string;
  records: LogRecord[];
  /** Двигает часы хранилища: истечение проверяется без ожидания месяца. */
  advance: (milliseconds: number) => void;
  read: () => { sessions: Record<string, unknown>[] };
};

function harness(
  options: {
    directory?: string;
    sweepIntervalMilliseconds?: number;
    isAccountPresent?: () => boolean;
  } = {},
): Harness {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), "sovereign-sessions-"));

  if (options.directory === undefined) {
    directories.push(directory);
  }

  const records: LogRecord[] = [];
  let clock = Date.parse("2026-07-28T10:00:00.000Z");

  const store = createLoginSessionStore({
    directory,
    logger: createLogger({
      source: "core",
      level: () => "debug",
      write: (record) => records.push(record),
    }),
    now: () => clock,
    ...(options.sweepIntervalMilliseconds === undefined
      ? {}
      : { sweepIntervalMilliseconds: options.sweepIntervalMilliseconds }),
    ...(options.isAccountPresent === undefined
      ? {}
      : { isAccountPresent: options.isAccountPresent }),
  });

  stores.push(store);

  return {
    store,
    directory,
    records,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    read: () =>
      JSON.parse(readFileSync(join(directory, loginSessionsFileName), "utf8")) as {
        sessions: Record<string, unknown>[];
      },
  };
}

describe("createLoginSessionStore", () => {
  it("opens a session and recognises its token", () => {
    const { store } = harness();

    const opened = store.open();

    assert.deepEqual(store.verify(opened.token), { kind: "live", id: opened.id });
  });

  it("does not recognise a token it never issued", () => {
    const { store } = harness();

    store.open();

    assert.deepEqual(store.verify("подделанный токен"), { kind: "unknown" });
  });

  it("gives every session its own token and identifier", () => {
    const { store } = harness();

    const first = store.open();
    const second = store.open();

    assert.notEqual(first.token, second.token);
    assert.notEqual(first.id, second.id);
    assert.deepEqual(store.verify(first.token), { kind: "live", id: first.id });
    assert.deepEqual(store.verify(second.token), { kind: "live", id: second.id });
  });

  it("issues a token a cookie carries without escaping", () => {
    const { store } = harness();

    assert.match(store.open().token, /^[A-Za-z0-9_-]+$/);
  });

  it("keeps the token itself off the disk", () => {
    const { store, read } = harness();

    const opened = store.open();
    const stored = read();

    // Копия директории данных не даёт живых сессий: на диске лежит SHA-256 токена
    // (docs/authentication.md).
    assert.equal(JSON.stringify(stored).includes(opened.token), false);
    assert.equal(
      stored.sessions[0]?.["tokenHash"],
      createHash("sha256").update(opened.token).digest("base64"),
    );
  });

  it("stores when the session was opened and when it expires", () => {
    const { store, read } = harness();

    store.open();

    const [session] = read().sessions;

    assert.equal(session?.["createdAt"], "2026-07-28T10:00:00.000Z");
    assert.equal(
      session?.["expiresAt"],
      new Date(Date.parse("2026-07-28T10:00:00.000Z") + sessionLifetimeMilliseconds).toISOString(),
    );
  });

  it("survives a restart of the daemon", () => {
    const { store, directory } = harness();

    const opened = store.open();

    // Сессии лежат файлом именно для этого: перезапуск демона не выкидывает человека из интерфейса
    // (docs/authentication.md).
    assert.deepEqual(harness({ directory }).store.verify(opened.token), {
      kind: "live",
      id: opened.id,
    });
  });

  it("stops recognising a token after the session is closed", () => {
    const { store, directory } = harness();

    const opened = store.open();

    store.close(opened.token);

    assert.deepEqual(store.verify(opened.token), { kind: "unknown" });

    // И после перезапуска тоже: запись удалена с диска, а не только из памяти.
    assert.deepEqual(harness({ directory }).store.verify(opened.token), { kind: "unknown" });
  });

  it("removes the closed session from the file", () => {
    const { store, read } = harness();

    const kept = store.open();
    const closed = store.open();

    store.close(closed.token);

    assert.deepEqual(
      read().sessions.map((session) => session["id"]),
      [kept.id],
    );
  });

  it("tells the listener which session closed", () => {
    const { store } = harness();

    const closed: string[] = [];
    const unsubscribe = store.subscribe((id) => closed.push(id));
    const opened = store.open();

    store.close(opened.token);

    // Живой SSE-поток обязан обрываться выходом, а не доживать до конца процесса
    // (docs/authentication.md): поток узнаёт об этом отсюда.
    assert.deepEqual(closed, [opened.id]);

    unsubscribe();
    store.close(store.open().token);

    assert.deepEqual(closed, [opened.id]);
  });

  it("says nothing to the listener about a token it never issued", () => {
    const { store } = harness();

    const closed: string[] = [];

    store.subscribe((id) => closed.push(id));
    store.close("подделанный токен");

    assert.deepEqual(closed, []);
  });

  it("stops recognising an expired session and tells the listener", () => {
    const { store, advance } = harness();

    const closed: string[] = [];

    store.subscribe((id) => closed.push(id));

    const opened = store.open();

    advance(sessionLifetimeMilliseconds - 1);
    assert.deepEqual(store.verify(opened.token), { kind: "live", id: opened.id });

    advance(1);

    // Истечение обязано быть явным: сессии переживают перезапуск, и без него токен жил бы вечно, а
    // истёкшие записи некому было бы вычищать (docs/authentication.md).
    assert.deepEqual(store.verify(opened.token), { kind: "unknown" });
    assert.deepEqual(closed, [opened.id]);
  });

  it("closes every session at once and tells the listener about each", () => {
    const { store, read } = harness();

    const closed: string[] = [];

    store.subscribe((id) => closed.push(id));

    const first = store.open();
    const second = store.open();

    store.closeAll();

    assert.deepEqual(store.verify(first.token), { kind: "unknown" });
    assert.deepEqual(store.verify(second.token), { kind: "unknown" });
    assert.deepEqual(closed.sort(), [first.id, second.id].sort());
    assert.deepEqual(read().sessions, []);
  });

  it("says nothing to the listener when there was nothing to close", () => {
    const { store } = harness();

    const closed: string[] = [];

    store.subscribe((id) => closed.push(id));
    store.closeAll();

    assert.deepEqual(closed, []);
  });

  it("keeps sessions and does not announce when closeAll cannot persist", () => {
    const { store, directory } = harness();
    const opened = store.open();
    const closed: string[] = [];

    store.subscribe((id) => closed.push(id));
    chmodSync(directory, 0o500);

    try {
      assert.throws(() => store.closeAll(), /permission denied/i);
    } finally {
      chmodSync(directory, 0o700);
    }

    assert.deepEqual(store.verify(opened.token), { kind: "live", id: opened.id });
    assert.deepEqual(closed, []);
  });

  it("sweeps expired sessions out of the file", () => {
    const { store, advance, read } = harness();

    store.open();

    advance(sessionLifetimeMilliseconds);

    const kept = store.open();

    assert.deepEqual(
      read().sessions.map((session) => session["id"]),
      [kept.id],
    );
  });

  it("sweeps an expired session without being asked anything", async () => {
    // Соединение живёт часами и проверяется только на входе: без уборки по времени истёкшая сессия
    // держала бы живой SSE-поток до следующего запроса, то есть сколь угодно долго
    // (docs/authentication.md).
    const { store, advance, read } = harness({ sweepIntervalMilliseconds: 5 });

    const closed: string[] = [];

    store.subscribe((id) => closed.push(id));

    const opened = store.open();

    advance(sessionLifetimeMilliseconds);

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(closed, [opened.id]);
    assert.deepEqual(read().sessions, []);
  });

  it("stops sweeping after it is stopped", async () => {
    const { store, advance, read } = harness({ sweepIntervalMilliseconds: 5 });

    store.open();
    store.stop();
    advance(sessionLifetimeMilliseconds);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Демон останавливается по сигналу, а не по последнему таймеру: уборщик обязан уметь замолчать.
    assert.equal(read().sessions.length, 1);
  });

  it("keeps an expired session and reports the write failure instead of throwing from the timer", async () => {
    const { store, directory, advance, records } = harness({ sweepIntervalMilliseconds: 5 });
    store.open();
    chmodSync(directory, 0o500);
    advance(sessionLifetimeMilliseconds);

    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      chmodSync(directory, 0o700);
    }

    assert.equal(
      records.some((record) => record.level === "error"),
      true,
    );
    assert.equal(
      (
        JSON.parse(readFileSync(join(directory, loginSessionsFileName), "utf8")) as {
          sessions: unknown[];
        }
      ).sessions.length,
      1,
    );
  });

  it("revokes sessions and announces when the account disappears", async () => {
    let accountPresent = true;
    const { store, advance } = harness({
      sweepIntervalMilliseconds: 5,
      isAccountPresent: () => accountPresent,
    });
    const opened = store.open();
    const closed: string[] = [];

    store.subscribe((id) => closed.push(id));
    accountPresent = false;
    advance(1);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(store.verify(opened.token), { kind: "unknown" });
    assert.deepEqual(closed, [opened.id]);
  });

  it("starts from an empty set when the file cannot be read", () => {
    const { directory, store: first } = harness();

    first.open();

    writeFileSync(join(directory, loginSessionsFileName), "{ это не json", "utf8");

    const restarted = harness({ directory });

    // Сессии — не настройки: негодный файл здесь стоит нового входа, а не отказа старта, и чинить
    // его человеку незачем.
    const opened = restarted.store.open();

    assert.deepEqual(restarted.store.verify(opened.token), { kind: "live", id: opened.id });
    assert.equal(
      restarted.records.some((record) => record.level === "warn"),
      true,
    );
  });
});
