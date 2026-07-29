/**
 * Провайдеры и модели через веб-API (docs/web-api.md, docs/models-and-providers.md). Маршрут своего
 * состояния не держит: каталог живёт в `@sovereign/agent-runtime-pi`, креды — в
 * `credential-store.ts`, здесь собирается ответ.
 */

import type { ProviderCatalogue } from "@sovereign/agent-runtime-pi";
import {
  coreEventTypes,
  providerCredentialPathPattern,
  providerModelsPathPattern,
  providersPath,
  providersRefreshPath,
  type ProviderModels,
} from "@sovereign/protocol";

import type { CredentialStore } from "./credential-store.ts";
import { respondWithError, respondWithJson, type Route } from "./dispatcher.ts";
import type { EventBus } from "./event-bus.ts";
import type { Logger } from "./logger.ts";
import type { ProviderLogins } from "./provider-logins.ts";

export type ProvidersRouteOptions = {
  /**
   * Каталог один на демон, а не свой у каждого набора маршрутов: он же ведёт вход в провайдера
   * (`provider-logins.ts`), и второй экземпляр означал бы вторую коллекцию провайдеров.
   */
  catalogue: ProviderCatalogue;
  credentials: Pick<CredentialStore, "problem">;
  logger: Logger;
  bus: Pick<EventBus, "publish">;
  /** Нужен выходу: логаут при живой попытке входа сначала отменяет её. */
  logins: Pick<ProviderLogins, "runningFor" | "cancel">;
};

export function providersRoutes(options: ProvidersRouteOptions): Route[] {
  const { catalogue } = options;

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
      method: "POST",
      path: providersRefreshPath,
      handle: async ({ response }) => {
        const report = await catalogue.refresh();

        // Событие публикуется всегда, а не «если что-то изменилось»: сравнивать списки моделей
        // ради экономии одного перезапроса дороже самого перезапроса.
        options.bus.publish(coreEventTypes.providersChanged, {});
        options.logger.info("dynamic model catalogues were refreshed", {
          providers: report.refreshed.length,
          failed: report.refreshed.filter((outcome) => outcome.error !== undefined).length,
        });
        respondWithJson(response, 200, report);
      },
    },
    {
      method: "DELETE",
      path: providerCredentialPathPattern,
      handle: async ({ response, parameters }) => {
        const providerId = parameters["providerId"] ?? "";
        const problem = options.credentials.problem();

        if (problem !== undefined) {
          respondWithError(response, 409, problem);

          return;
        }

        // Сначала отмена, потом выход: идущий вход дописал бы кред обратно уже после удаления, и
        // человек увидел бы провайдера настроенным сразу после нажатия «выйти».
        const running = options.logins.runningFor(providerId);

        if (running !== undefined) {
          options.logins.cancel(running.attemptId);
        }

        await catalogue.logout(providerId);
        options.bus.publish(coreEventTypes.providerLogout, { providerId });
        options.logger.info("a provider was logged out", { providerId });

        // Кред из окружения выходом не убрать: он не наш. Провайдер останется настроенным, и вью
        // обязано сказать об этом — здесь для этого отдаётся его нынешний статус.
        const snapshot = await catalogue.snapshot();
        const summary = snapshot.providers.find((provider) => provider.id === providerId);

        if (summary === undefined) {
          respondWithError(response, 404, "not found");

          return;
        }

        respondWithJson(response, 200, summary);
      },
    },
    {
      method: "GET",
      path: providerModelsPathPattern,
      handle: ({ response, parameters }) => {
        const providerId = parameters["providerId"] ?? "";
        const models = catalogue.modelsOf(providerId);

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
