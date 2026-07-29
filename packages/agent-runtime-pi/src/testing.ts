/**
 * Двойники для тестов — и наших, и демона. Лежат в пакете, а не в тестах демона, потому что
 * собраны они из типов Pi: демону они недоступны (docs/architecture.md).
 */

import { createProvider } from "@earendil-works/pi-ai";
import type {
  ApiKeyCredential,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Provider,
} from "@earendil-works/pi-ai";

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

/**
 * Шаг сценария провайдера-двойника — в терминах рантайма, а не протокола: двойник изображает
 * провайдера Pi, и перевод шагов должен работать на нём по-настоящему.
 */
export type ScriptedStep =
  | { say: AuthEvent }
  | { ask: AuthPrompt }
  /** Отказать входом. Так проверяется отказ провайдера, а не отмена человеком. */
  | { fail: string };

export type ScriptedProviderOptions = {
  id?: string;
  name?: string;
  /** Что провайдер делает в ходе входа. Ответы на вопросы собираются в `answers`. */
  script?: ScriptedStep[];
  /** Ключ, который вход записывает в кред, если сценарий дошёл до конца. */
  key?: string;
};

export type ScriptedProvider = {
  provider: Provider;
  /** Ответы, которые пришли на вопросы сценария, в порядке вопросов. */
  answers: string[];
};

/**
 * Провайдер с заранее написанным ходом входа. Нужен потому, что весь OAuth у настоящих провайдеров
 * требует настоящего аккаунта: без двойника механика шагов осталась бы непроверенной вовсе
 * (docs/agent-runtime-contract.md). Живёт в пакете, а не в тестах демона: собран он из типов Pi,
 * а демону они недоступны (docs/architecture.md).
 */
export function scriptedProvider(options: ScriptedProviderOptions = {}): ScriptedProvider {
  const answers: string[] = [];
  const script = options.script ?? [];

  const login = async (interaction: AuthInteraction): Promise<ApiKeyCredential> => {
    for (const step of script) {
      if ("say" in step) {
        interaction.notify(step.say);
      } else if ("ask" in step) {
        answers.push(await interaction.prompt(step.ask));
      } else {
        throw new Error(step.fail);
      }
    }

    return { type: "api_key", key: options.key ?? "s3cret" };
  };

  const provider = createProvider({
    id: options.id ?? "scripted",
    name: options.name ?? "Scripted",
    models: [],
    // Запросов к модели в этом срезе нет вовсе, и двойник их не изображает: попытка стримить через
    // него — это ошибка теста, и молчать о ней нельзя.
    api: {
      stream: () => {
        throw new Error("двойник провайдера не отвечает на запросы к модели");
      },
    } as never,
    auth: {
      apiKey: {
        name: `${options.name ?? "Scripted"} key`,
        login,
        resolve: async ({ credential }) =>
          credential?.key === undefined
            ? undefined
            : { auth: { apiKey: credential.key }, source: "stored credential" },
      },
    },
  });

  return { provider, answers };
}
