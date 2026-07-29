/**
 * Двойники для тестов — и наших, и демона. Лежат в пакете, а не в тестах демона, потому что
 * собраны они из типов Pi: демону они недоступны (docs/architecture.md).
 */

import type { CredentialVault } from "./credentials.ts";
import type { Environment } from "./environment.ts";

/** Хранилище кредов в памяти. Тот же контракт, что у файла демона, без файла. */
export function inMemoryVault(initial: Record<string, unknown> = {}): CredentialVault {
  const credentials = new Map(Object.entries(initial));
  const queues = new Map<string, Promise<unknown>>();

  const enqueue = <Result>(providerId: string, step: () => Promise<Result>): Promise<Result> => {
    const previous = queues.get(providerId) ?? Promise.resolve();
    const next = previous.then(step, step);

    queues.set(
      providerId,
      next.catch(() => undefined),
    );

    return next;
  };

  return {
    read: (providerId) => Promise.resolve(credentials.get(providerId)),
    list: () => [...credentials.keys()],
    modify: (providerId, write) =>
      enqueue(providerId, async () => {
        const written = await write(credentials.get(providerId));

        if (written !== undefined) {
          credentials.set(providerId, written);
        }

        return credentials.get(providerId);
      }),
    remove: (providerId) =>
      enqueue(providerId, async () => {
        credentials.delete(providerId);
      }),
    problem: () => undefined,
  };
}

/** Окружение без окружения: ни одной переменной, ни одного файла. */
export function emptyEnvironment(variables: Record<string, string> = {}): Environment {
  return {
    read: (name) => Promise.resolve(variables[name]),
    fileExists: () => Promise.resolve(false),
  };
}
