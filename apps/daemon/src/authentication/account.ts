/**
 * Учётная запись владельца (docs/authentication.md). Она одна: пользователь один, ролей нет.
 *
 * Здесь же торможение подбора, потому что владелец пароля и владелец счётчика неудач — один и тот же
 * объект: проверка пароля стоит 69 мс по построению (runtime-checks.md, проверка 11), то есть сам
 * маршрут входа становится способом занять процессор, и разносить проверку с её тормозом по разным
 * модулям значило бы разрешить позвать проверку мимо тормоза.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomically } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";

export const accountFileName = "account.json";

/**
 * Параметры scrypt. Имена развёрнуты: `N`, `r` и `p` из статьи ничего не говорят читателю кода, а
 * соответствие с `ScryptOptions` держится в одном месте — в `deriveKey`.
 */
export type ScryptParameters = {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLengthBytes: number;
};

/**
 * Действующий набор: на нём проверка стоит 69 мс (runtime-checks.md, проверка 11). Набор лежит рядом
 * с хешем в файле, поэтому его можно поднять со временем, не ломая существующий вход — при успешной
 * проверке старым набором хеш пересчитывается этим.
 */
export const currentScryptParameters: ScryptParameters = {
  cost: 32_768,
  blockSize: 8,
  parallelization: 1,
  keyLengthBytes: 64,
};

/** Соль на 16 байт из `randomBytes` (docs/authentication.md). */
const saltLengthBytes = 16;

/** Первая пауза после неудачи; дальше вдвое до потолка. */
export const firstPauseMilliseconds = 250;

/**
 * Потолок паузы. Большим он быть не может: пауза держит соединение открытым, а браузер даёт шесть на
 * источник (runtime-checks.md, проверка 9). Смысл в том, чтобы подбор был бессмысленным, а не в том,
 * чтобы запереть вход навсегда, — поэтому это пауза, а не блокировка (docs/authentication.md).
 */
export const maximumPauseMilliseconds = 2_000;

export type AccountState =
  | { kind: "absent" }
  | { kind: "present" }
  /** Файл есть, но применить его нельзя. Починить это может только человек (docs/data-directory.md). */
  | { kind: "unreadable"; reason: string };

export type CreateAccountOutcome =
  | { kind: "created" }
  /** Учётная запись уже есть: создаётся она ровно один раз, первым входом. */
  | { kind: "conflict" }
  | { kind: "unreadable"; reason: string };

export type VerifyPasswordOutcome =
  | { kind: "accepted" }
  | { kind: "rejected" }
  /** Проверять нечем: записи об учётной записи ещё нет. */
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string };

export type AccountStore = {
  state: () => AccountState;
  create: (password: string) => Promise<CreateAccountOutcome>;
  /** Считает хеш и тормозит подбор. Одновременная проверка одна. */
  verify: (password: string) => Promise<VerifyPasswordOutcome>;
};

export type CreateAccountStoreOptions = {
  directory: string;
  logger: Logger;
  parameters?: ScryptParameters;
  /** Пауза торможения. Подменяется в тесте: иначе он спал бы секундами. */
  wait?: (milliseconds: number) => Promise<void>;
};

export function createAccountStore(options: CreateAccountStoreOptions): AccountStore {
  const path = join(options.directory, accountFileName);
  const parameters = options.parameters ?? currentScryptParameters;
  const wait = options.wait ?? defaultWait;

  /**
   * Счётчик один на демон и живёт в памяти: пользователь один, вход локальный, а перезапуск демона
   * требует доступа к машине (docs/authentication.md).
   */
  let failures = 0;

  // Очередь на всю работу с паролем: хеширование сериализовано, поэтому занять процессор множеством
  // одновременных попыток нельзя. Пауза лежит внутри очереди, а не рядом с ней, — иначе поток
  // попыток тормозился бы только на ответе и продолжал считать хеши.
  let queue: Promise<unknown> = Promise.resolve();

  const serialize = <Value>(work: () => Promise<Value>): Promise<Value> => {
    const result = queue.then(work, work);

    queue = result.catch(() => undefined);

    return result;
  };

  const state = (): AccountState => {
    const stored = read(path);

    if (stored.kind === "missing") {
      return { kind: "absent" };
    }

    return stored.kind === "unreadable"
      ? { kind: "unreadable", reason: stored.reason }
      : { kind: "present" };
  };

  return {
    state,
    create: (password) =>
      serialize(async () => {
        const stored = read(path);

        if (stored.kind === "unreadable") {
          return { kind: "unreadable", reason: stored.reason };
        }

        if (stored.kind === "read") {
          return { kind: "conflict" };
        }

        await write(path, password, parameters, new Date().toISOString());

        options.logger.info("the account was created by the first login");

        return { kind: "created" };
      }),
    verify: (password) =>
      serialize(async () => {
        const stored = read(path);

        if (stored.kind === "unreadable") {
          return { kind: "unreadable", reason: stored.reason };
        }

        if (stored.kind === "missing") {
          return { kind: "absent" };
        }

        const account = stored.account;
        const expected = Buffer.from(account.passwordHash, "base64");
        let actual: Buffer;

        try {
          actual = await deriveKey(
            password,
            Buffer.from(account.salt, "base64"),
            account.parameters,
          );
        } catch (cause) {
          options.logger.error("the account parameters were rejected by scrypt", {
            file: accountFileName,
            reason: cause instanceof Error ? cause.message : String(cause),
          });

          return {
            kind: "unreadable",
            reason: `${accountFileName} has unusable scrypt parameters`,
          };
        }

        // Длины сравниваются до `timingSafeEqual`: он бросает на разной длине. Сойтись они обязаны —
        // чтение требует, чтобы хеш совпадал по длине с заявленной в файле, — но падать здесь из-за
        // ошибки в этом требовании было бы худшим из ответов.
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
          failures += 1;

          const pauseMilliseconds = pauseFor(failures);

          // Ответ не различает «пароль неверен» и «ты слишком частишь»; факт торможения виден
          // владельцу здесь, а не тому, кто стучится (docs/authentication.md).
          options.logger.warn("the login attempt was refused and slowed down", {
            failures,
            pauseMilliseconds,
          });

          await wait(pauseMilliseconds);

          return { kind: "rejected" };
        }

        failures = 0;

        // Единственный момент, когда пароль известен, — успешная проверка. Поднятые параметры
        // применяются здесь или никогда (docs/authentication.md).
        if (!sameParameters(account.parameters, parameters)) {
          await write(path, password, parameters, account.createdAt);

          options.logger.info("the password hash was recomputed with the current parameters", {
            parameters,
          });
        }

        return { kind: "accepted" };
      }),
  };
}

/**
 * Что лежит в `account.json`. Соль и хеш — base64: директория данных текстовая, и запись обязана
 * открываться редактором, даже если править её руками незачем (docs/data-directory.md).
 */
type StoredAccount = {
  passwordHash: string;
  salt: string;
  parameters: ScryptParameters;
  createdAt: string;
};

type ReadOutcome =
  | { kind: "missing" }
  | { kind: "read"; account: StoredAccount }
  | { kind: "unreadable"; reason: string };

function read(path: string): ReadOutcome {
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return { kind: "missing" };
    }

    throw cause;
  }

  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return {
      kind: "unreadable",
      reason: `${accountFileName} is not valid json: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const account = asAccount(document);

  // Негодный файл не лечится записью поверх: под ним лежит единственный пароль владельца, и
  // затереть его значило бы запереть человека снаружи (docs/data-directory.md).
  return account === undefined
    ? { kind: "unreadable", reason: `${accountFileName} does not hold an account record` }
    : { kind: "read", account };
}

function asAccount(document: unknown): StoredAccount | undefined {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return undefined;
  }

  const fields = document as Record<string, unknown>;
  const parameters = asParameters(fields["parameters"]);

  if (
    parameters === undefined ||
    typeof fields["passwordHash"] !== "string" ||
    typeof fields["salt"] !== "string" ||
    typeof fields["createdAt"] !== "string"
  ) {
    return undefined;
  }

  // Хеш и соль проверяются по декодированной длине, а не только по типу: base64 в Node молча
  // проглатывает мусор, и обрезанный хеш иначе выглядел бы просто как «другой пароль». Длина хеша
  // заявлена в самом файле, поэтому расхождение с ней — негодная запись, а не иной набор.
  if (
    Buffer.from(fields["passwordHash"], "base64").length !== parameters.keyLengthBytes ||
    Buffer.from(fields["salt"], "base64").length === 0
  ) {
    return undefined;
  }

  return {
    passwordHash: fields["passwordHash"],
    salt: fields["salt"],
    parameters,
    createdAt: fields["createdAt"],
  };
}

/**
 * Набор проверяется по существу, а не только на «целое положительное»: `scrypt` бросает на
 * непригодном наборе, и поправленный руками файл иначе давал бы `500` на входе вместо
 * документированного отказа «файл негоден» (docs/data-directory.md).
 */
function asParameters(raw: unknown): ScryptParameters | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const fields = raw as Record<string, unknown>;
  const names = ["cost", "blockSize", "parallelization", "keyLengthBytes"] as const;

  for (const name of names) {
    const value = fields[name];

    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      return undefined;
    }
  }

  const parameters: ScryptParameters = {
    cost: fields["cost"] as number,
    blockSize: fields["blockSize"] as number,
    parallelization: fields["parallelization"] as number,
    keyLengthBytes: fields["keyLengthBytes"] as number,
  };

  // Стоимость обязана быть степенью двойки не меньше четырёх — меньший набор Node отвергает.
  if (parameters.cost < 4 || (parameters.cost & (parameters.cost - 1)) !== 0) {
    return undefined;
  }

  if (parameters.keyLengthBytes > maximumKeyLengthBytes) {
    return undefined;
  }

  // Потолок памяти: набор задаёт, сколько демон возьмёт на одну проверку, и число из файла не имеет
  // права ни съесть машину, ни переполнить `maxmem`, который у Node 32-битный.
  return hashMemoryBytes(parameters) > maximumHashMemoryBytes ? undefined : parameters;
}

/** Столько памяти требует один счёт хеша: `128 * N * r * p` — формула самого scrypt. */
function hashMemoryBytes(parameters: ScryptParameters): number {
  return 128 * parameters.cost * parameters.blockSize * parameters.parallelization;
}

/** Действующему набору нужно 32 МиБ, то есть запас здесь тридцатикратный. */
const maximumHashMemoryBytes = 1024 * 1024 * 1024;

/** Хеш поставки — 64 байта; килобайт оставляет запас для смены формата без неограниченной аллокации. */
const maximumKeyLengthBytes = 1024;

async function write(
  path: string,
  password: string,
  parameters: ScryptParameters,
  createdAt: string,
): Promise<void> {
  const salt = randomBytes(saltLengthBytes);
  const account: StoredAccount = {
    passwordHash: (await deriveKey(password, salt, parameters)).toString("base64"),
    salt: salt.toString("base64"),
    parameters,
    createdAt,
  };

  writeFileAtomically(path, `${JSON.stringify(account, undefined, 2)}\n`);
}

/**
 * Асинхронный `scrypt`, а не `scryptSync`: 69 мс синхронного счёта — это 69 мс, в которые демон не
 * отвечает ни на один запрос, включая SSE-поток. Очередь на проверки всё равно своя, поэтому от
 * асинхронности не появляется ни одной одновременной проверки.
 */
function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      parameters.keyLengthBytes,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        // Предел памяти считается от параметров, а не берётся константой: набор `N=2^15, r=8`
        // требует ровно 32 МиБ, то есть упирается в потолок Node по умолчанию.
        maxmem: 2 * hashMemoryBytes(parameters),
      },
      (cause, key) => {
        if (cause !== null) {
          reject(cause);

          return;
        }

        resolve(key);
      },
    );
  });
}

function sameParameters(left: ScryptParameters, right: ScryptParameters): boolean {
  return (
    left.cost === right.cost &&
    left.blockSize === right.blockSize &&
    left.parallelization === right.parallelization &&
    left.keyLengthBytes === right.keyLengthBytes
  );
}

/**
 * Пауза растёт вдвое от первой и упирается в потолок. Величины не настройка ни в `config.json`, ни в
 * `preferences.json`: настройка здесь означала бы способ отключить защиту правкой файла
 * (docs/authentication.md).
 */
function pauseFor(failures: number): number {
  return Math.min(firstPauseMilliseconds * 2 ** (failures - 1), maximumPauseMilliseconds);
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
