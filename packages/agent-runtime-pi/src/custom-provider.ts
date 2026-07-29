/**
 * Сборка кастомного провайдера из данных (docs/models-and-providers.md).
 *
 * Определение приходит от плагина через границу воркера, поэтому в нём нет ни одной функции: всё,
 * что провайдеру нужно уметь, собирается здесь — реализация протокола API берётся по имени, а способ
 * ключа строится стандартным помощником рантайма.
 */

import {
  createProvider,
  envApiKeyAuth,
  type Api,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type {
  CustomModelDefinition,
  CustomProviderApi,
  CustomProviderDefinition,
} from "@sovereign/protocol";

/**
 * Реализации протоколов API. Перечень закрыт именно здесь: имя из определения — это ключ таблицы, а
 * не строка, которую можно придумать. Модули грузятся лениво самим рантаймом, поэтому таблица
 * ничего не стоит до первого запроса к модели.
 */
const apiImplementations: Record<CustomProviderApi, () => ReturnType<typeof openAICompletionsApi>> =
  {
    "openai-completions": openAICompletionsApi,
    "openai-responses": openAIResponsesApi,
    "anthropic-messages": anthropicMessagesApi,
    "google-generative-ai": googleGenerativeAIApi,
  };

export function toRuntimeProvider(definition: CustomProviderDefinition): Provider {
  return createProvider({
    id: definition.id,
    name: definition.name,
    baseUrl: definition.baseUrl,
    // `envApiKeyAuth` даёт и разрешение креда, и вход по ключу: провайдер плагина умеет то же, что
    // встроенный, и входить в него можно тем же диалогом.
    auth: {
      apiKey: envApiKeyAuth(definition.apiKey.label, definition.apiKey.environmentVariables ?? []),
    },
    models: definition.models.map((model) => toRuntimeModel(definition, model)),
    api: apiImplementations[definition.api](),
  });
}

function toRuntimeModel(
  provider: CustomProviderDefinition,
  model: CustomModelDefinition,
): Model<Api> {
  return {
    id: model.id,
    name: model.name,
    api: provider.api,
    provider: provider.id,
    baseUrl: provider.baseUrl,
    reasoning: model.reasoning ?? false,
    input: [...(model.input ?? ["text"])],
    // Цены кеша в нашем описании модели нет вовсе (docs/models-and-providers.md), поэтому здесь
    // ноль: считать чтение кеша по цене входа значило бы придумать число за автора.
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}
