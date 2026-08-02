/**
 * Креды LLM-провайдеров на диске (docs/models-and-providers.md, docs/data-directory.md).
 * Единственный писатель кредов — платформа, и единственный писатель файла — этот модуль.
 *
 * **Значение креда здесь непрозрачно (`unknown`).** Форму знает только `@sovereign/agent-runtime-pi`,
 * и это делает правило «платформа не читает значение креда» свойством типов, а не обещанием.
 *
 * Отличие от соседних сторов, из-за которого он выглядит иначе: **снаружи асинхронный, внутри
 * синхронный.** Файл читается один раз при создании и живёт в памяти, как у всех, а обещания нужны
 * контракту рантайма и сериализации `modify` — внутри неё рантайм обновляет OAuth-токен сетевым
 * запросом, и держится это секундами.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomically } from "./platform/public.ts";
import type { Logger } from "./platform/public.ts";

export const credentialsFileName = "credentials.json";

/** Что записывает вместо креда тот, кто ничего не менял. */
export type CredentialWriter = (current: unknown) => Promise<unknown>;

export type CredentialStore = {
  read: (providerId: string) => Promise<unknown>;
  /** Идентификаторы провайдеров, у которых есть кред. Значения не отдаются: их незачем перечислять. */
  list: () => string[];
  /**
   * Единственный путь записи — сериализованный read-modify-write. Взаимное исключение по
   * идентификатору провайдера, а не общее: общий замок сделал бы зависшее обновление токена одного
   * провайдера блокировкой записи для всех.
   */
  modify: (providerId: string, write: CredentialWriter) => Promise<unknown>;
  /** Выход из провайдера. Сериализован против `modify` той же цепочкой. */
  remove: (providerId: string) => Promise<void>;
  /** Почему файл не читается, если не читается. Пишущие маршруты отвечают по нему отказом. */
  problem: () => string | undefined;
};

export type CreateCredentialStoreOptions = {
  directory: string;
  logger: Logger;
};

export function createCredentialStore(options: CreateCredentialStoreOptions): CredentialStore {
  const path = join(options.directory, credentialsFileName);
  const file = readCredentials(path, options.logger);
  const credentials = new Map(file.kind === "read" ? Object.entries(file.credentials) : []);

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

  const persist = (snapshot: Map<string, unknown> = credentials): void => {
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

  return {
    read: (providerId) => Promise.resolve(credentials.get(providerId)),
    list: () => [...credentials.keys()],
    modify: (providerId, write) =>
      enqueue(providerId, async () => {
        refuseWhenUnreadable();

        const written = await write(credentials.get(providerId));

        if (written === undefined) {
          return credentials.get(providerId);
        }

        const snapshot = new Map(credentials);
        snapshot.set(providerId, written);
        persist(snapshot);
        credentials.set(providerId, written);
        options.logger.info("a provider credential was written", { providerId });

        return written;
      }),
    remove: (providerId) =>
      enqueue(providerId, async () => {
        refuseWhenUnreadable();

        if (credentials.has(providerId)) {
          const snapshot = new Map(credentials);
          snapshot.delete(providerId);
          persist(snapshot);
          credentials.delete(providerId);
          options.logger.info("a provider credential was removed", { providerId });
        }
      }),
    problem: () => (file.kind === "refused" ? file.reason : undefined),
  };
}

type CredentialsFile =
  { kind: "read"; credentials: Record<string, unknown> } | { kind: "refused"; reason: string };

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

  // Дальше формы значения не проверяем: её знает рантайм, а не платформа. Проверяем ровно то, что
  // видно отсюда, — что запись вообще похожа на кред, а не на строку, дописанную руками.
  for (const [providerId, credential] of Object.entries(entries)) {
    if (asObject(credential) === undefined) {
      return refuse(`${credentialsFileName}: the credential of ${providerId} is not an object`);
    }
  }

  return { kind: "read", credentials: entries };
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}
