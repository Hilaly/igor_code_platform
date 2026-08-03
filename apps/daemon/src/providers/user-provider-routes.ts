import {
  coreEventTypes,
  parseUserProviderDraft,
  userProviderPathPattern,
  userProviderRefreshPathPattern,
  userProvidersPath,
} from "@sovereign/protocol";

import { respondWithError, respondWithJson, type Route } from "../http/public.ts";
import type { EventBus, Logger } from "../platform/public.ts";
import type { UserProviderOutcome, UserProviders } from "./user-providers.ts";

export function userProviderRoutes(options: {
  providers: UserProviders;
  bus: Pick<EventBus, "publish">;
  logger: Logger;
}): Route[] {
  const mutate = (
    response: Parameters<Route["handle"]>[0]["response"],
    outcome: UserProviderOutcome,
  ) => {
    if (outcome.kind === "done") {
      options.bus.publish(coreEventTypes.providersChanged, {});
      options.logger.info("a user provider was changed", {
        providerId: outcome.details.definition.id,
      });
      respondWithJson(response, 200, outcome.details);
    } else if (outcome.kind === "removed") {
      options.bus.publish(coreEventTypes.providersChanged, {});
      options.logger.info("a user provider was removed", { providerId: outcome.id });
      respondWithJson(response, 200, { id: outcome.id });
    } else if (outcome.kind === "unknown") respondWithError(response, 404, "not found");
    else if (outcome.kind === "taken")
      respondWithError(response, 409, "provider identifier is taken");
    else if (outcome.kind === "busy")
      respondWithError(response, 409, "provider has an active session");
    else respondWithError(response, 409, outcome.reason);
  };

  return [
    {
      method: "GET",
      path: userProvidersPath,
      handle: ({ response }) =>
        respondWithJson(response, 200, { providers: options.providers.list() }),
    },
    {
      method: "POST",
      path: userProvidersPath,
      handle: ({ response, body }) => {
        const parsed = parseUserProviderDraft(body);
        if (parsed.kind === "rejected")
          return respondWithError(response, 400, parsed.diagnostics.join("; "));
        mutate(response, options.providers.create(parsed.value));
      },
    },
    {
      method: "GET",
      path: userProviderPathPattern,
      handle: ({ response, parameters }) => {
        const found = options.providers.find(parameters["providerId"] ?? "");
        if (found === undefined) {
          respondWithError(response, 404, "not found");
        } else {
          respondWithJson(response, 200, found);
        }
      },
    },
    {
      method: "PUT",
      path: userProviderPathPattern,
      handle: ({ response, parameters, body }) => {
        const parsed = parseUserProviderDraft(body);
        if (parsed.kind === "rejected")
          return respondWithError(response, 400, parsed.diagnostics.join("; "));
        mutate(response, options.providers.replace(parameters["providerId"] ?? "", parsed.value));
      },
    },
    {
      method: "DELETE",
      path: userProviderPathPattern,
      handle: async ({ response, parameters }) =>
        mutate(response, await options.providers.remove(parameters["providerId"] ?? "")),
    },
    {
      method: "POST",
      path: userProviderRefreshPathPattern,
      handle: async ({ response, parameters }) =>
        mutate(response, await options.providers.refresh(parameters["providerId"] ?? "")),
    },
  ];
}
