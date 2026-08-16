/**
 * Провайдеры и модели через веб-API (docs/web-api.md, docs/models-and-providers.md). Маршрут своего
 * состояния не держит: каталог живёт в `@sovereign/agent-runtime-pi`, креды — в
 * `credential-store.ts`, здесь собирается ответ.
 */

import type { ProviderCatalogue } from "@sovereign/agent-runtime-pi";
import {
  coreEventTypes,
  parseProviderKeyUpdate,
  providerCredentialPathPattern,
  providerKeyPathPattern,
  providerModelsPathPattern,
  providersPath,
  providersRefreshPath,
  type ProviderModels,
  type ProviderSummary,
} from "@sovereign/protocol";

import type { CredentialStore } from "./credential-store.ts";
import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { EventBus } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";
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
        await respondWithProvider(response, catalogue, providerId);
      },
    },
    {
      method: "PUT",
      path: providerKeyPathPattern,
      handle: async ({ response, body, parameters }) => {
        const providerId = parameters["providerId"] ?? "";
        const keyId = parameters["keyId"] ?? "";
        const problem = options.credentials.problem();

        if (problem !== undefined) {
          respondWithError(response, 409, problem);

          return;
        }

        const parsed = parseProviderKeyUpdate(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        // Подпись меняется раньше выбора: обе правки идут одним телом, и отказ на второй не должен
        // оставлять первую применённой молча.
        if (parsed.value.label !== undefined) {
          if (!(await catalogue.renameKey(providerId, keyId, parsed.value.label))) {
            respondWithError(response, 404, "not found");

            return;
          }
        }

        if (parsed.value.selected === true && !(await catalogue.selectKey(providerId, keyId))) {
          respondWithError(response, 404, "not found");

          return;
        }

        options.bus.publish(coreEventTypes.providersChanged, {});
        options.logger.info("a provider key was changed", { providerId, keyId });
        await respondWithProvider(response, catalogue, providerId);
      },
    },
    {
      method: "DELETE",
      path: providerKeyPathPattern,
      handle: async ({ response, parameters }) => {
        const providerId = parameters["providerId"] ?? "";
        const keyId = parameters["keyId"] ?? "";
        const problem = options.credentials.problem();

        if (problem !== undefined) {
          respondWithError(response, 409, problem);

          return;
        }

        // Идущий вход дописал бы ключ обратно уже после удаления — ровно как при выходе целиком.
        const running = options.logins.runningFor(providerId);

        if (running !== undefined) {
          options.logins.cancel(running.attemptId);
        }

        if (!(await catalogue.removeKey(providerId, keyId))) {
          respondWithError(response, 404, "not found");

          return;
        }

        // Событие то же, что у выхода: ушёл последний ключ — провайдер стал ненастроенным, и для
        // слушающего это тот же факт.
        options.bus.publish(coreEventTypes.providerLogout, { providerId });
        options.logger.info("a provider key was removed", { providerId, keyId });
        await respondWithProvider(response, catalogue, providerId);
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

/**
 * Ответ правящего маршрута — нынешнее состояние провайдера целиком. Вью показывает и статус, и
 * набор ключей, и после правки они обязаны быть согласованы между собой: два запроса вместо одного
 * дали бы вкладке состояние, которого на сервере не было ни в один момент.
 */
async function respondWithProvider(
  response: Parameters<typeof respondWithJson>[0],
  catalogue: Pick<ProviderCatalogue, "snapshot">,
  providerId: string,
): Promise<void> {
  const snapshot = await catalogue.snapshot();
  const summary: ProviderSummary | undefined = snapshot.providers.find(
    (provider) => provider.id === providerId,
  );

  if (summary === undefined) {
    respondWithError(response, 404, "not found");

    return;
  }

  respondWithJson(response, 200, summary);
}
