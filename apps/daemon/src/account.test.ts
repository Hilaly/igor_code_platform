import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";

import {
  accountFileName,
  createAccountStore,
  currentScryptParameters,
  maximumPauseMilliseconds,
  type AccountStore,
  type ScryptParameters,
} from "./account.ts";
import { createLogger } from "./logger.ts";

/** Дешёвые параметры: тест проверяет механику, а не стоимость хеша. Реальные — отдельным тестом. */
const cheapParameters: ScryptParameters = {
  cost: 1_024,
  blockSize: 8,
  parallelization: 1,
  keyLengthBytes: 64,
};

const directories: string[] = [];

after(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type Harness = {
  store: AccountStore;
  directory: string;
  records: LogRecord[];
  /** Паузы торможения в порядке запроса. Ожидание подменено: тест не спит секундами. */
  pauses: number[];
  /** Отпустить удержанные паузы и больше не удерживать. */
  release: () => void;
  read: () => Record<string, unknown>;
};

type HarnessOptions = {
  parameters?: ScryptParameters;
  directory?: string;
  /** Держать паузу до `release()`: так видно, продвинулась ли вторая проверка мимо первой. */
  holdPauses?: boolean;
};

function harness(options: HarnessOptions = {}): Harness {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), "sovereign-account-"));

  if (options.directory === undefined) {
    directories.push(directory);
  }

  const records: LogRecord[] = [];
  const pauses: number[] = [];
  const held: (() => void)[] = [];
  let holding = options.holdPauses ?? false;

  const store = createAccountStore({
    directory,
    logger: createLogger({
      source: "core",
      level: () => "debug",
      write: (record) => records.push(record),
    }),
    parameters: options.parameters ?? cheapParameters,
    wait: (milliseconds) => {
      pauses.push(milliseconds);

      // Пауза нулевой длины: механика проверяется по записанным величинам, а не по часам.
      return holding ? new Promise<void>((resolve) => held.push(resolve)) : Promise.resolve();
    },
  });

  return {
    store,
    directory,
    records,
    pauses,
    release: () => {
      holding = false;

      for (const resolve of held.splice(0)) {
        resolve();
      }
    },
    read: () =>
      JSON.parse(readFileSync(join(directory, accountFileName), "utf8")) as Record<string, unknown>,
  };
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("createAccountStore", () => {
  it("reports an absent account until it is created", async () => {
    const { store } = harness();

    assert.deepEqual(store.state(), { kind: "absent" });
    assert.deepEqual(await store.create("правильный пароль"), { kind: "created" });
    assert.deepEqual(store.state(), { kind: "present" });
  });

  it("refuses to create a second account", async () => {
    const { store } = harness();

    await store.create("первый пароль");

    assert.deepEqual(await store.create("второй пароль"), { kind: "conflict" });
  });

  it("keeps the password out of the file and the parameters next to the hash", async () => {
    const { store, read } = harness();

    await store.create("пароль в открытом виде");

    const stored = read();

    assert.equal(JSON.stringify(stored).includes("пароль в открытом виде"), false);
    assert.deepEqual(stored["parameters"], cheapParameters);
    assert.equal(typeof stored["passwordHash"], "string");
    assert.equal(typeof stored["salt"], "string");
    assert.equal(typeof stored["createdAt"], "string");
  });

  it("gives every account its own salt", async () => {
    const first = harness();
    const second = harness();

    await first.store.create("один и тот же пароль");
    await second.store.create("один и тот же пароль");

    assert.notEqual(first.read()["salt"], second.read()["salt"]);
    assert.notEqual(first.read()["passwordHash"], second.read()["passwordHash"]);
  });

  it("accepts the password it was created with and rejects any other", async () => {
    const { store } = harness();

    await store.create("правильный пароль");

    assert.deepEqual(await store.verify("правильный пароль"), { kind: "accepted" });
    assert.deepEqual(await store.verify("неправильный пароль"), { kind: "rejected" });
  });

  it("reads the account from disk, not from memory", async () => {
    const { store, directory } = harness();

    await store.create("правильный пароль");

    // Второе хранилище на той же директории — это перезапуск демона: сессии его переживают, значит
    // и запись об учётной записи обязана читаться с диска.
    const restarted = harness({ directory });

    assert.deepEqual(await restarted.store.verify("правильный пароль"), { kind: "accepted" });
  });

  it("says the account is absent instead of rejecting the password", async () => {
    const { store } = harness();

    // Разница видна интерфейсу: «нет учётной записи» — это форма регистрации, а не отказ входа.
    assert.deepEqual(await store.verify("любой пароль"), { kind: "absent" });
  });

  it("refuses to work with a file it cannot read instead of overwriting it", async () => {
    const { store, directory } = harness();

    writeFileSync(join(directory, accountFileName), "{ это не json", "utf8");

    const state = store.state();

    assert.equal(state.kind, "unreadable");
    assert.equal((await store.verify("любой пароль")).kind, "unreadable");
    assert.equal((await store.create("любой пароль")).kind, "unreadable");
    assert.equal(readFileSync(join(directory, accountFileName), "utf8"), "{ это не json");
  });

  it("calls a file with impossible parameters unreadable instead of failing on the hash", async () => {
    const { store, directory } = harness();

    await store.create("правильный пароль");

    const stored = JSON.parse(readFileSync(join(directory, accountFileName), "utf8")) as {
      parameters: ScryptParameters;
    };

    // Стоимость обязана быть степенью двойки: `scrypt` бросает на любой другой, и без этой проверки
    // правка файла руками превращала бы вход в `500` вместо документированного отказа.
    writeFileSync(
      join(directory, accountFileName),
      JSON.stringify({ ...stored, parameters: { ...stored.parameters, cost: 3 } }),
      "utf8",
    );

    assert.equal(store.state().kind, "unreadable");
    assert.equal((await store.verify("правильный пароль")).kind, "unreadable");
  });

  it("calls a file whose hash does not match its own key length unreadable", async () => {
    const { store, directory } = harness();

    await store.create("правильный пароль");

    const stored = JSON.parse(readFileSync(join(directory, accountFileName), "utf8")) as {
      passwordHash: string;
    };

    // Обрезанный хеш — это не «другой пароль», а негодная запись: длина заявлена в самом файле.
    writeFileSync(
      join(directory, accountFileName),
      JSON.stringify({ ...stored, passwordHash: stored.passwordHash.slice(0, 8) }),
      "utf8",
    );

    assert.equal(store.state().kind, "unreadable");
  });

  it("calls a file whose salt is not base64 unreadable", async () => {
    const { store, directory } = harness();

    await store.create("правильный пароль");

    const stored = JSON.parse(readFileSync(join(directory, accountFileName), "utf8")) as {
      salt: string;
    };

    writeFileSync(
      join(directory, accountFileName),
      JSON.stringify({ ...stored, salt: "!!!" }),
      "utf8",
    );

    assert.equal(store.state().kind, "unreadable");
  });

  it("calls parameters rejected by node scrypt unreadable", async () => {
    const { store, directory } = harness();

    await store.create("правильный пароль");

    const stored = JSON.parse(readFileSync(join(directory, accountFileName), "utf8")) as {
      parameters: ScryptParameters;
    };

    writeFileSync(
      join(directory, accountFileName),
      JSON.stringify({ ...stored, parameters: { ...stored.parameters, cost: 2, blockSize: 1 } }),
      "utf8",
    );

    assert.equal((await store.verify("правильный пароль")).kind, "unreadable");
  });

  it("calls an unreasonably long key unreadable", async () => {
    const { store, directory } = harness();

    await store.create("правильный пароль");

    const stored = JSON.parse(readFileSync(join(directory, accountFileName), "utf8")) as {
      parameters: ScryptParameters;
    };

    writeFileSync(
      join(directory, accountFileName),
      JSON.stringify({
        ...stored,
        passwordHash: Buffer.alloc(1_025).toString("base64"),
        parameters: { ...stored.parameters, keyLengthBytes: 1_025 },
      }),
      "utf8",
    );

    assert.equal((await store.verify("правильный пароль")).kind, "unreadable");
  });

  it("grows the pause after every failure and drops it after a success", async () => {
    const { store, pauses } = harness();

    await store.create("правильный пароль");
    await store.verify("мимо");
    await store.verify("мимо");
    await store.verify("мимо");

    assert.deepEqual(pauses, [250, 500, 1_000]);

    await store.verify("правильный пароль");
    await store.verify("мимо");

    // Успешный вход сбрасывает счётчик: защита от подбора не должна запирать вход насовсем.
    assert.deepEqual(pauses, [250, 500, 1_000, 250]);
  });

  it("stops growing the pause at the ceiling", async () => {
    const { store, pauses } = harness();

    await store.create("правильный пароль");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await store.verify("мимо");
    }

    // Потолок обязан быть небольшим: пауза держит соединение, а их шесть на источник.
    assert.equal(Math.max(...pauses), maximumPauseMilliseconds);
    assert.equal(pauses.at(-1), maximumPauseMilliseconds);
  });

  it("checks one password at a time", async () => {
    const { store, pauses, release } = harness({ holdPauses: true });

    await store.create("правильный пароль");

    const both = Promise.all([store.verify("мимо"), store.verify("мимо")]);

    // Первая проверка успела дойти до паузы: дешёвый scrypt считается единицы миллисекунд.
    await delay(100);

    // Вторая за эти сто миллисекунд не посчитала свой хеш — иначе здесь лежала бы вторая пауза.
    // Отсюда и следует, что процессор множеством попыток занять нельзя (docs/authentication.md).
    assert.deepEqual(pauses, [250]);

    release();

    await both;

    assert.deepEqual(pauses, [250, 500]);
  });

  it("writes down that it is slowing an attempt down", async () => {
    const { store, records } = harness();

    await store.create("правильный пароль");
    await store.verify("мимо");

    // Факт торможения виден владельцу в журнале, а не тому, кто стучится.
    const slowed = records.find((record) => record.message.includes("slow"));

    assert.equal(slowed?.level, "warn");
    assert.equal(slowed?.["pauseMilliseconds"], 250);
  });

  it("says nothing about the password itself in the log", async () => {
    const { store, records } = harness();

    await store.create("совершенно секретный пароль");
    await store.verify("совершенно секретный пароль");
    await store.verify("мимо");

    assert.equal(JSON.stringify(records).includes("совершенно секретный"), false);
  });

  it("rehashes with the current parameters after a success on the old ones", async () => {
    const { store, directory, read } = harness();

    await store.create("правильный пароль");

    const stale = read();
    const raised: ScryptParameters = { ...cheapParameters, cost: 2_048 };
    const upgraded = harness({ directory, parameters: raised });

    assert.deepEqual(await upgraded.store.verify("правильный пароль"), { kind: "accepted" });

    // Поднятые параметры нельзя применить, не зная пароля: единственный момент, когда он известен, —
    // успешная проверка (docs/authentication.md).
    assert.deepEqual(read()["parameters"], raised);
    assert.notEqual(read()["passwordHash"], stale["passwordHash"]);
    assert.equal(read()["createdAt"], stale["createdAt"]);

    // Пароль после пересчёта прежний.
    assert.deepEqual(await upgraded.store.verify("правильный пароль"), { kind: "accepted" });
  });

  it("leaves the hash alone when the parameters already match", async () => {
    const { store, directory, read } = harness();

    await store.create("правильный пароль");

    const before = read();

    await harness({ directory }).store.verify("правильный пароль");

    assert.deepEqual(read(), before);
  });

  it("works with the parameters the platform actually ships", async () => {
    // Проверка 11 в runtime-checks.md мерила ровно этот набор; здесь он проверяется целиком, вместе
    // с записью на диск и обратным чтением, потому что 128 * cost * blockSize упирается в maxmem.
    const { store } = harness({ parameters: currentScryptParameters });

    assert.deepEqual(await store.create("правильный пароль"), { kind: "created" });
    assert.deepEqual(await store.verify("правильный пароль"), { kind: "accepted" });
    assert.deepEqual(await store.verify("мимо"), { kind: "rejected" });
  });
});
