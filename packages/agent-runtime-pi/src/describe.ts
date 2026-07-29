/**
 * Перевод провайдеров и моделей Pi в типы протокола. Это и есть граница: дальше по системе
 * не уезжает ни один тип рантайма (docs/architecture.md).
 */

import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type {
  ModelSummary,
  ProviderAuthState,
  ProviderLoginMethod,
  ProviderSummary,
} from "@sovereign/protocol";

export type ProviderFacts = {
  auth: ProviderAuthState;
  custom: boolean;
};

export function describeProvider(provider: Provider, facts: ProviderFacts): ProviderSummary {
  return {
    id: provider.id,
    name: provider.name,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    logins: loginMethods(provider),
    auth: facts.auth,
    dynamic: typeof provider.refreshModels === "function",
    custom: facts.custom,
    modelCount: knownModels(provider).length,
  };
}

export function describeModel(model: Model<Api>): ModelSummary {
  return {
    id: model.id,
    name: model.name,
    providerId: model.provider,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: { input: model.cost.input, output: model.cost.output },
  };
}

export function describeModels(provider: Provider): ModelSummary[] {
  return knownModels(provider).map(describeModel);
}

/**
 * Способ входа есть там, где у метода авторизации есть `login`. У ключа его может не быть — тогда
 * кред приходит только из окружения; у подписки он обязателен по контракту Pi.
 */
function loginMethods(provider: Provider): ProviderLoginMethod[] {
  const methods: ProviderLoginMethod[] = [];
  const { apiKey, oauth } = provider.auth;

  if (apiKey?.login) {
    methods.push({ type: "api_key", label: apiKey.name });
  }

  if (oauth) {
    // `loginLabel` — подпись именно кнопки входа («Sign in with SuperGrok or X Premium»);
    // `name` называет способ («Anthropic (Claude Pro/Max)»). Первая точнее, когда есть.
    methods.push({ type: "oauth", label: oauth.loginLabel ?? oauth.name });
  }

  return methods;
}

/**
 * Контракт Pi требует, чтобы `getModels()` не бросал, и сам Pi считает бросающую реализацию
 * пустой. Каталог кастомного провайдера приносит плагин, поэтому дисциплину повторяем и мы.
 */
function knownModels(provider: Provider): readonly Model<Api>[] {
  try {
    return provider.getModels();
  } catch {
    return [];
  }
}
