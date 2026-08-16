/**
 * Алиасы моделей через веб-API (docs/web-api.md, docs/model-routing.md).
 *
 * Маршруты своего состояния не держат: определения живут в `model-alias-store.ts`, а каталог
 * провайдеров пересобирает провайдера алиасов на каждую правку — иначе выбранный человеком алиас не
 * появился бы в пикере до перезапуска демона.
 */

import type { ProviderCatalogue } from "@sovereign/agent-runtime-pi";
import {
  coreEventTypes,
  modelAliasPath,
  modelAliasPathPattern,
  modelAliasesPath,
  parseModelAliasDraft,
  type ModelAliasDeleted,
  type ModelAliasesSnapshot,
} from "@sovereign/protocol";

import type { ModelAliasStore } from "./model-alias-store.ts";
import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { EventBus, Logger } from "../platform/public.ts";

export type ModelAliasRoutesOptions = {
  store: ModelAliasStore;
  /** Тот же каталог, что у маршрутов провайдеров: второй означал бы вторую коллекцию моделей. */
  catalogue: Pick<ProviderCatalogue, "setAliases">;
  bus: Pick<EventBus, "publish">;
  logger: Logger;
};

export function modelAliasRoutes(options: ModelAliasRoutesOptions): Route[] {
  const { store, catalogue } = options;

  /** Применить набор к каталогу и сказать об этом всем: список моделей — глобальное состояние. */
  const applied = (): void => {
    catalogue.setAliases(store.list());
    options.bus.publish(coreEventTypes.providersChanged, {});
  };

  return [
    {
      method: "GET",
      path: modelAliasesPath,
      handle: ({ response }) => {
        const problem = store.problem();
        const snapshot: ModelAliasesSnapshot = {
          aliases: store.list(),
          ...(problem === undefined ? {} : { problem }),
        };

        respondWithJson(response, 200, snapshot);
      },
    },
    {
      method: "POST",
      path: modelAliasesPath,
      handle: ({ response, body }) => {
        const parsed = parseModelAliasDraft(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        const outcome = store.create(parsed.value);

        if (outcome.kind === "refused") {
          respondWithError(response, 409, outcome.reason);

          return;
        }

        if (outcome.kind === "taken") {
          respondWithError(response, 409, `the alias ${parsed.value.id} is already taken`);

          return;
        }

        applied();
        options.logger.info("a model alias was created", { aliasId: parsed.value.id });
        respondWithJson(response, 200, parsed.value);
      },
    },
    {
      method: "PUT",
      path: modelAliasPathPattern,
      handle: ({ response, body, parameters }) => {
        const aliasId = parameters["aliasId"] ?? "";
        const parsed = parseModelAliasDraft(body);

        if (parsed.kind === "rejected") {
          respondWithError(response, 400, parsed.diagnostics.join("; "));

          return;
        }

        const outcome = store.replace(aliasId, parsed.value);

        switch (outcome.kind) {
          case "refused":
            respondWithError(response, 409, outcome.reason);

            return;
          case "identifier_changed":
            // Идентификатор — часть ссылки на модель в сессиях: смена имени оборвала бы их молча.
            respondWithError(response, 409, "the identifier of an alias cannot be changed");

            return;
          case "unknown":
            respondWithError(response, 404, "not found");

            return;
          default:
            applied();
            options.logger.info("a model alias was replaced", { aliasId });
            respondWithJson(response, 200, parsed.value);
        }
      },
    },
    {
      method: "DELETE",
      path: modelAliasPathPattern,
      handle: ({ response, parameters }) => {
        const aliasId = parameters["aliasId"] ?? "";
        const outcome = store.remove(aliasId);

        if (outcome.kind === "refused") {
          respondWithError(response, 409, outcome.reason);

          return;
        }

        if (outcome.kind === "unknown") {
          respondWithError(response, 404, "not found");

          return;
        }

        applied();
        options.logger.info("a model alias was removed", { aliasId });

        const body: ModelAliasDeleted = { id: aliasId };

        respondWithJson(response, 200, body);
      },
    },
  ];
}

export { modelAliasPath };
