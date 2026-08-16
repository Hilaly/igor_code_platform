/**
 * Алиасы моделей как провайдер каталога (docs/model-routing.md).
 *
 * Алиас становится моделью провайдера `alias`, и этим он даром получает всё, что и так умеет
 * платформа: выбор в пикере, ссылку `alias/opus-5` в сессии, запись смены модели в дереве,
 * восстановление после перезапуска и поверхность SDK. Ни протокол сессий, ни веб об алиасах при
 * этом знать не обязаны.
 *
 * **Пределы алиаса — минимум по кандидатам.** Окно контекста и максимум ответа берутся наименьшие,
 * входы — пересечение, ризонинг — только если умеют все: harness считает бюджет по объявленным
 * числам, и завышенные означали бы компакцию, которая приходит слишком поздно.
 */

import { createProvider } from "@earendil-works/pi-ai";
import type { Api, Model, Models, Provider } from "@earendil-works/pi-ai";
import { aliasProviderId, type ModelAlias } from "@sovereign/protocol";

/** Пределы алиаса, у которого не разрешился ни один кандидат: те же, что у неизвестной модели. */
const unknownCandidate = {
  contextWindow: 128_000,
  maxTokens: 8_192,
  api: "openai-completions" as Api,
};

export type CreateAliasProviderOptions = {
  aliases: readonly ModelAlias[];
  /** Каталог, в котором ищутся кандидаты. Их пределы и api берутся у них же. */
  models: Models;
};

/**
 * Провайдер алиасов. `undefined` — алиасов нет вовсе, и провайдера в каталоге быть не должно: пустой
 * провайдер в списке человека — это строка, которая ничего не делает.
 */
export function createAliasProvider(options: CreateAliasProviderOptions): Provider | undefined {
  if (options.aliases.length === 0) {
    return undefined;
  }

  const resolved = options.aliases.map((alias) => ({
    alias,
    candidates: alias.candidates
      .map((candidate) => options.models.getModel(candidate.providerId, candidate.modelId))
      .filter((model): model is Model<Api> => model !== undefined),
  }));

  return createProvider({
    id: aliasProviderId,
    name: "Алиасы",
    models: resolved.map(({ alias, candidates }) => describeAlias(alias, candidates)),
    auth: {
      apiKey: {
        name: "Ключи моделей алиаса",
        /**
         * Алиас настроен, если настроен хоть один его кандидат: своего креда у него нет и быть не
         * может. Ключ здесь фиктивный — запрос всё равно уходит ключом кандидата
         * (docs/model-routing.md).
         */
        resolve: async () => {
          for (const { candidates } of resolved) {
            for (const candidate of candidates) {
              if ((await options.models.checkAuth(candidate.provider)) !== undefined) {
                return { auth: { apiKey: aliasProviderId }, source: "ключи моделей алиаса" };
              }
            }
          }

          return undefined;
        },
      },
    },
    api: {
      // Сюда попадают только те, кто взял модель алиаса мимо сессии: маршрутизатор подменяет её на
      // кандидата раньше. Молчаливый запрос в несуществующий провайдер был бы хуже названного отказа.
      stream: () => {
        throw new Error("an alias is only usable inside an agent session");
      },
      streamSimple: () => {
        throw new Error("an alias is only usable inside an agent session");
      },
    },
  });
}

function describeAlias(alias: ModelAlias, candidates: readonly Model<Api>[]): Model<Api> {
  const first = candidates[0];

  return {
    id: alias.id,
    name: alias.name,
    provider: aliasProviderId,
    api: first?.api ?? unknownCandidate.api,
    contextWindow:
      least(candidates.map((model) => model.contextWindow)) ?? unknownCandidate.contextWindow,
    maxTokens: least(candidates.map((model) => model.maxTokens)) ?? unknownCandidate.maxTokens,
    // Ризонинг обещается только если его умеют все: иначе уровень, заданный человеком, молча
    // потеряется на первом же кандидате, который его не понимает.
    reasoning: candidates.length > 0 && candidates.every((model) => model.reasoning),
    input: intersect(candidates.map((model) => [...model.input])),
    cost: first?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Адрес обязателен по типу модели, но никогда не используется: запрос уходит по адресу
    // кандидата, а сам алиас стримить отказывается.
    baseUrl: first?.baseUrl ?? "https://alias.invalid",
  };
}

function least(values: number[]): number | undefined {
  return values.length === 0 ? undefined : Math.min(...values);
}

type ModelInput = Model<Api>["input"][number];

/** Вход, который принимают все кандидаты. Пусто у алиаса без кандидатов — только текст. */
function intersect(inputs: ModelInput[][]): ModelInput[] {
  const first = inputs[0];

  if (first === undefined) {
    return ["text"];
  }

  return first.filter((one) => inputs.every((input) => input.includes(one)));
}
