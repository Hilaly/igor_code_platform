/**
 * Креды LLM-провайдеров на диске (docs/models-and-providers.md, docs/data-directory.md).
 * Единственный писатель кредов — платформа, и единственный писатель файла — этот модуль.
 *
 * **У провайдера не один кред, а набор именованных ключей.** Один из них выбран: им ходит всё, что
 * спрашивает провайдера целиком, — проверка авторизации, обновление списка моделей, вход. Сессия
 * агента берёт ключ из набора сама (docs/models-and-providers.md).
 *
 * **Значение ключа здесь непрозрачно (`unknown`).** Форму знает только `@sovereign/agent-runtime-pi`,
 * и это делает правило «платформа не читает значение креда» свойством типов, а не обещанием. Своё у
 * платформы только обёртка: идентификатор ключа и подпись, которую написал человек.
 *
 * Отличие от соседних сторов, из-за которого он выглядит иначе: **снаружи асинхронный, внутри
 * синхронный.** Файл читается один раз при создании и живёт в памяти, как у всех, а обещания нужны
 * контракту рантайма и сериализации `modify` — внутри неё рантайм обновляет OAuth-токен сетевым
 * запросом, и держится это секундами.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomically } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";

export const credentialsFileName = "credentials.json";

/** Что записывает вместо креда тот, кто ничего не менял. */
export type CredentialWriter = (current: unknown) => Promise<unknown>;

/** Ключ глазами платформы: она знает, как он называется, но не что в нём лежит. */
export type CredentialKey = {
  id: string;
  /** Подпись, которую дал человек. Пустая — ключ заведён без имени. */
  label: string;
};

/**
 * Куда направлена запись входа. Новый ключ заводится **только если вход что-то записал**: отменённый
 * диалог не должен оставлять после себя пустую строчку в наборе.
 */
export type CredentialKeyTarget =
  { kind: "new"; label: string } | { kind: "existing"; keyId: string };

export type CredentialStore = {
  /** Кред выбранного ключа. Этим путём провайдера читает рантайм, и про набор он не знает. */
  read: (providerId: string) => Promise<unknown>;
  /** Идентификаторы провайдеров, у которых есть хоть один ключ. Значения не отдаются. */
  list: () => string[];
  /** Ключи провайдера в порядке добавления. */
  keys: (providerId: string) => CredentialKey[];
  /** Какой ключ выбран. `undefined` — у провайдера нет ни одного. */
  selected: (providerId: string) => string | undefined;
  /** Кред названного ключа. `undefined` — такого ключа нет. */
  readKey: (providerId: string, keyId: string) => Promise<unknown>;
  /**
   * Единственный путь записи — сериализованный read-modify-write. Взаимное исключение по
   * идентификатору провайдера, а не общее: общий замок сделал бы зависшее обновление токена одного
   * провайдера блокировкой записи для всех.
   *
   * Пишет в выбранный ключ, а внутри `withKeyTarget` — в названную там цель.
   */
  modify: (providerId: string, write: CredentialWriter) => Promise<unknown>;
  /** То же, но в названный ключ. Несуществующий ключ — `undefined` и ни одной записи. */
  modifyKey: (providerId: string, keyId: string, write: CredentialWriter) => Promise<unknown>;
  /**
   * Провести вход так, чтобы его запись ушла в названную цель. Возвращает идентификатор ключа, в
   * который записали, — или `undefined`, если вход не записал ничего.
   */
  withKeyTarget: <Result>(
    providerId: string,
    target: CredentialKeyTarget,
    run: () => Promise<Result>,
  ) => Promise<{ result: Result; keyId: string | undefined }>;
  /** Сделать ключ выбранным. `false` — такого ключа нет. */
  select: (providerId: string, keyId: string) => Promise<boolean>;
  /** Переименовать ключ. `false` — такого ключа нет. */
  rename: (providerId: string, keyId: string, label: string) => Promise<boolean>;
  /** Убрать один ключ. `false` — такого ключа нет. */
  removeKey: (providerId: string, keyId: string) => Promise<boolean>;
  /** Выход из провайдера целиком: набор уходит весь. Сериализован против `modify` той же цепочкой. */
  remove: (providerId: string) => Promise<void>;
  /** Почему файл не читается, если не читается. Пишущие маршруты отвечают по нему отказом. */
  problem: () => string | undefined;
};

export type CreateCredentialStoreOptions = {
  directory: string;
  logger: Logger;
};

type StoredKey = CredentialKey & { credential: unknown };
type KeySet = { keys: StoredKey[]; selected: string };

/** Цель входа и то, что по ней записали: `withKeyTarget` обязан назвать заведённый ключ. */
type ActiveTarget = { target: CredentialKeyTarget; written?: string };

export function createCredentialStore(options: CreateCredentialStoreOptions): CredentialStore {
  const path = join(options.directory, credentialsFileName);
  const file = readCredentials(path, options.logger);
  const credentials = new Map(file.kind === "read" ? Object.entries(file.credentials) : []);

  /**
   * Куда идёт `modify` во время входа. Держится в стороне от очереди, а не удержанным звеном:
   * внутри входа рантайм зовёт `modify` сам, и удержанная цепочка заперла бы его насмерть.
   */
  const targets = new Map<string, ActiveTarget>();

  /**
   * Очередь на провайдера. Держит последнее обещание цепочки: следующая операция ждёт его, чем и
   * достигается взаимное исключение — без замков, которые надо не забыть отпустить.
   */
  const queues = new Map<string, Promise<unknown>>();

  const enqueue = <Result>(providerId: string, step: () => Promise<Result>): Promise<Result> => {
    const previous = queues.get(providerId) ?? Promise.resolve();
    // Отказ предыдущей операции не отменяет следующую: провалившийся вход не должен запирать
    // провайдера до перезапуска.
    const next = previous.then(step, step);

    queues.set(
      providerId,
      next.catch(() => undefined),
    );

    return next;
  };

  const persist = (snapshot: Map<string, KeySet>): void => {
    writeFileAtomically(
      path,
      `${JSON.stringify({ credentials: Object.fromEntries(snapshot) }, undefined, 2)}\n`,
    );
  };

  const refuseWhenUnreadable = (): void => {
    if (file.kind === "refused") {
      throw new Error(file.reason);
    }
  };

  const keyOf = (providerId: string, keyId: string): StoredKey | undefined =>
    credentials.get(providerId)?.keys.find((key) => key.id === keyId);

  /**
   * Запись набора целиком. Снимок собирается рядом и подменяет память только после удачной записи:
   * упавшая запись не должна оставить память и диск разными.
   */
  const commit = (providerId: string, set: KeySet | undefined): void => {
    const snapshot = new Map(credentials);

    if (set === undefined) {
      snapshot.delete(providerId);
    } else {
      snapshot.set(providerId, set);
    }

    persist(snapshot);

    if (set === undefined) {
      credentials.delete(providerId);
    } else {
      credentials.set(providerId, set);
    }
  };

  /** Записать кред по цели, заведя ключ, если цель — новый. Возвращает идентификатор ключа. */
  const writeInto = (
    providerId: string,
    target: CredentialKeyTarget,
    credential: unknown,
  ): string => {
    const set = credentials.get(providerId);

    if (target.kind === "new") {
      const id = freeKeyId(set?.keys ?? []);

      // Первый ключ выбирается сам: набор без выбранного ключа означал бы провайдера, в которого
      // вошли, но которым нельзя ходить.
      commit(providerId, {
        keys: [...(set?.keys ?? []), { id, label: target.label, credential }],
        selected: set === undefined ? id : set.selected,
      });

      return id;
    }

    commit(providerId, {
      keys: (set?.keys ?? []).map((key) =>
        key.id === target.keyId ? { ...key, credential } : key,
      ),
      selected: set?.selected ?? target.keyId,
    });

    return target.keyId;
  };

  /** Общее тело записи. Зовётся уже внутри очереди провайдера, поэтому сама не встаёт в неё. */
  const writeStep = async (
    providerId: string,
    target: CredentialKeyTarget,
    write: CredentialWriter,
  ): Promise<unknown> => {
    refuseWhenUnreadable();

    const current = target.kind === "new" ? undefined : keyOf(providerId, target.keyId)?.credential;
    const written = await write(current);

    if (written === undefined) {
      return current;
    }

    const keyId = writeInto(providerId, target, written);
    const active = targets.get(providerId);

    if (active !== undefined) {
      active.written = keyId;
    }

    options.logger.info("a provider credential was written", { providerId, keyId });

    return written;
  };

  return {
    read: (providerId) => {
      const set = credentials.get(providerId);

      return Promise.resolve(
        set === undefined ? undefined : keyOf(providerId, set.selected)?.credential,
      );
    },
    list: () => [...credentials.keys()],
    keys: (providerId) =>
      (credentials.get(providerId)?.keys ?? []).map(({ id, label }) => ({ id, label })),
    selected: (providerId) => credentials.get(providerId)?.selected,
    readKey: (providerId, keyId) => Promise.resolve(keyOf(providerId, keyId)?.credential),
    modify: (providerId, write) =>
      enqueue(providerId, () => {
        const selected = credentials.get(providerId)?.selected;
        const target: CredentialKeyTarget =
          targets.get(providerId)?.target ??
          (selected === undefined
            ? { kind: "new", label: "" }
            : { kind: "existing", keyId: selected });

        return writeStep(providerId, target, write);
      }),
    modifyKey: (providerId, keyId, write) =>
      enqueue(providerId, async () => {
        refuseWhenUnreadable();

        return keyOf(providerId, keyId) === undefined
          ? undefined
          : writeStep(providerId, { kind: "existing", keyId }, write);
      }),
    withKeyTarget: async (providerId, target, run) => {
      const active: ActiveTarget = { target };

      // Вход в одного провайдера идёт по одному (docs/models-and-providers.md), поэтому цель не
      // может смениться посреди чужого входа. Обновление OAuth-токена рядом с входом промахнётся
      // мимо выбранного ключа, но не испортит его: свой кред оно записывает только поверх своего.
      targets.set(providerId, active);

      try {
        const result = await run();

        return { result, keyId: active.written };
      } finally {
        targets.delete(providerId);
      }
    },
    select: (providerId, keyId) =>
      enqueue(providerId, async () => {
        refuseWhenUnreadable();

        const set = credentials.get(providerId);

        if (set === undefined || keyOf(providerId, keyId) === undefined) {
          return false;
        }

        if (set.selected !== keyId) {
          commit(providerId, { ...set, selected: keyId });
          options.logger.info("a provider key was selected", { providerId, keyId });
        }

        return true;
      }),
    rename: (providerId, keyId, label) =>
      enqueue(providerId, async () => {
        refuseWhenUnreadable();

        const set = credentials.get(providerId);

        if (set === undefined || keyOf(providerId, keyId) === undefined) {
          return false;
        }

        commit(providerId, {
          ...set,
          keys: set.keys.map((key) => (key.id === keyId ? { ...key, label } : key)),
        });

        return true;
      }),
    removeKey: (providerId, keyId) =>
      enqueue(providerId, async () => {
        refuseWhenUnreadable();

        const set = credentials.get(providerId);

        if (set === undefined || keyOf(providerId, keyId) === undefined) {
          return false;
        }

        const keys = set.keys.filter((key) => key.id !== keyId);
        const first = keys[0];

        // Убрали выбранный — выбранным становится первый оставшийся: набор без выбранного ключа
        // равносилен провайдеру без креда, а кред у него ещё есть.
        commit(
          providerId,
          first === undefined
            ? undefined
            : { keys, selected: set.selected === keyId ? first.id : set.selected },
        );
        options.logger.info("a provider key was removed", { providerId, keyId });

        return true;
      }),
    remove: (providerId) =>
      enqueue(providerId, async () => {
        refuseWhenUnreadable();

        if (credentials.has(providerId)) {
          commit(providerId, undefined);
          options.logger.info("a provider credential was removed", { providerId });
        }
      }),
    problem: () => (file.kind === "refused" ? file.reason : undefined),
  };
}

/** Первый свободный номер. Идентификатор виден человеку в файле, поэтому он короткий, а не uuid. */
function freeKeyId(keys: readonly CredentialKey[]): string {
  const taken = new Set(keys.map((key) => key.id));

  for (let number = 1; ; number += 1) {
    const id = `key-${number}`;

    if (!taken.has(id)) {
      return id;
    }
  }
}

type CredentialsFile =
  { kind: "read"; credentials: Record<string, KeySet> } | { kind: "refused"; reason: string };

/**
 * Негодный файл — отказ, и переписан он не будет: под ним лежат OAuth-токены, которые заново взять
 * неоткуда без похода к провайдеру. Пустой набор здесь означал бы, что платформа молча разлогинила
 * человека везде и сама же записала это на диск (docs/data-directory.md).
 */
function readCredentials(path: string, logger: Logger): CredentialsFile {
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return { kind: "read", credentials: {} };
    }

    throw cause;
  }

  const refuse = (reason: string): CredentialsFile => {
    logger.error("the credentials file was not applied and every provider write will refuse", {
      file: credentialsFileName,
      reason,
    });

    return { kind: "refused", reason };
  };

  let document: unknown;

  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return refuse(
      `${credentialsFileName} is not valid json: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const stored = asObject(document)?.["credentials"];
  const entries = asObject(stored);

  if (entries === undefined) {
    return refuse(`${credentialsFileName} does not hold a set of credentials`);
  }

  const credentials: Record<string, KeySet> = {};

  for (const [providerId, entry] of Object.entries(entries)) {
    const set = asKeySet(providerId, entry);

    if (typeof set === "string") {
      return refuse(`${credentialsFileName}: ${set}`);
    }

    credentials[providerId] = set;
  }

  return { kind: "read", credentials };
}

/**
 * Разбор записи провайдера. Дальше формы значения не идём: её знает рантайм, а не платформа.
 * Проверяется ровно то, что видно отсюда, — что запись похожа на набор ключей или на прежний
 * одиночный кред, а не на строку, дописанную руками.
 *
 * **Прежняя форма узнаётся по полю `type`,** которое есть у любого креда рантайма; у набора его нет
 * вовсе. Так две формы не путаются даже с OAuth-кредом, у которого свои произвольные поля.
 */
function asKeySet(providerId: string, entry: unknown): KeySet | string {
  const fields = asObject(entry);

  if (fields === undefined) {
    return `the credential of ${providerId} is not an object`;
  }

  if (typeof fields["type"] === "string") {
    // Файл прежней формы. На чтении он не переписывается — чтение вообще ничего не пишет, — а
    // первая же запись сохранит уже набор.
    return { keys: [{ id: "key-1", label: "", credential: fields }], selected: "key-1" };
  }

  const stored = fields["keys"];

  if (!Array.isArray(stored)) {
    return `the credential of ${providerId} is neither a credential nor a set of keys`;
  }

  if (stored.length === 0) {
    return `the key set of ${providerId} is empty`;
  }

  const keys: StoredKey[] = [];

  for (const raw of stored) {
    const key = asObject(raw);
    const id = key?.["id"];
    const label = key?.["label"] ?? "";
    const credential = asObject(key?.["credential"]);

    if (typeof id !== "string" || id === "" || typeof label !== "string") {
      return `a key of ${providerId} is not named by a label and an identifier`;
    }

    if (credential === undefined) {
      return `the key ${id} of ${providerId} holds no credential object`;
    }

    if (keys.some((existing) => existing.id === id)) {
      return `${providerId} has two keys named ${id}`;
    }

    keys.push({ id, label, credential });
  }

  const selected = fields["selected"];
  const first = keys[0] as StoredKey;

  if (selected !== undefined && typeof selected !== "string") {
    return `the selected key of ${providerId} is not named by identifier`;
  }

  if (typeof selected === "string" && !keys.some((key) => key.id === selected)) {
    return `${providerId} selects the key ${selected}, which it does not have`;
  }

  return { keys, selected: selected ?? first.id };
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}
