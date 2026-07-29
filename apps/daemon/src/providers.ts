/**
 * Провайдеры и модели через веб-API (docs/web-api.md, docs/models-and-providers.md). Маршрут своего
 * состояния не держит: каталог живёт в `@sovereign/agent-runtime-pi`, креды — в
 * `credential-store.ts`, здесь собирается ответ.
 */

import {
  createProviderCatalogue,
  type Environment,
  type ProviderCatalogue,
} from "@sovereign/agent-runtime-pi";
import { providerModelsPathPattern, providersPath, type ProviderModels } from "@sovereign/protocol";

import type { CredentialStore } from "./credential-store.ts";
import { respondWithError, respondWithJson, type Route } from "./dispatcher.ts";
import type { Logger } from "./logger.ts";

export type ProvidersRouteOptions = {
  credentials: CredentialStore;
  logger: Logger;
  /** Окружение, из которого провайдер вправе взять кред. Подменяется только тестами. */
  environment?: Environment;
};

export function providersRoutes(options: ProvidersRouteOptions): Route[] {
  const catalogue: ProviderCatalogue = createProviderCatalogue({
    credentials: options.credentials,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
  });

  return [
    {
      method: "GET",
      path: providersPath,
      handle: async ({ response }) => {
        // Негодный файл кредов здесь не отказ, в отличие от проектов: каталог провайдеров от него не
        // зависит, статус у всех становится «сказать нечем», и беда едет в теле снимка.
        respondWithJson(response, 200, await catalogue.snapshot());
      },
    },
    {
      method: "GET",
      path: providerModelsPathPattern,
      handle: ({ response, parameters }) => {
        const providerId = parameters["providerId"] ?? "";
        const models = catalogue.models(providerId);

        if (models === undefined) {
          respondWithError(response, 404, "not found");

          return;
        }

        const body: ProviderModels = { providerId, models };

        respondWithJson(response, 200, body);
      },
    },
  ];
}
