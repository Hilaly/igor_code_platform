import type { ProviderCatalogue } from "@sovereign/agent-runtime-pi";
import type {
  UserProviderDefinition,
  UserProviderDetails,
  UserProviderRefreshState,
} from "@sovereign/protocol";

import type { CredentialStore } from "./credential-store.ts";
import type { ModelCatalogStore } from "./model-catalog-store.ts";
import type { UserProviderStore } from "./user-provider-store.ts";

export type UserProviderOutcome =
  | { kind: "done"; details: UserProviderDetails }
  | { kind: "removed"; id: string }
  | { kind: "unknown" }
  | { kind: "taken" }
  | { kind: "busy" }
  | { kind: "refused"; reason: string };

export type UserProviders = {
  list: () => UserProviderDetails[];
  find: (id: string) => UserProviderDetails | undefined;
  create: (definition: UserProviderDefinition) => UserProviderOutcome;
  replace: (id: string, definition: UserProviderDefinition) => UserProviderOutcome;
  remove: (id: string) => Promise<UserProviderOutcome>;
  refresh: (id: string) => Promise<UserProviderOutcome>;
};

export function createUserProviders(options: {
  store: UserProviderStore;
  catalogue: ProviderCatalogue;
  credentials: Pick<CredentialStore, "remove">;
  catalogs: Pick<ModelCatalogStore, "remove">;
  hasActiveSession: (providerId: string) => boolean;
}): UserProviders {
  const conflicts = new Map<string, string>();
  const refreshed = new Map<string, UserProviderRefreshState>();

  for (const definition of options.store.list()) {
    const outcome = options.catalogue.setCustomProvider(definition, "user");
    if (outcome.kind === "taken")
      conflicts.set(definition.id, "provider identifier is already taken");
  }

  const details = (definition: UserProviderDefinition): UserProviderDetails => ({
    definition,
    ...(conflicts.has(definition.id) ? { conflict: conflicts.get(definition.id) } : {}),
    ...(refreshed.has(definition.id) ? { refresh: refreshed.get(definition.id) } : {}),
  });

  return {
    list: () => options.store.list().map(details),
    find: (id) => {
      const definition = options.store.find(id);
      return definition === undefined ? undefined : details(definition);
    },
    create: (definition) => {
      const registered = options.catalogue.setCustomProvider(definition, "user");
      if (registered.kind === "taken") return { kind: "taken" };
      const stored = options.store.create(definition);
      if (stored.kind !== "created") {
        options.catalogue.removeCustomProvider(definition.id, "user");
        return stored.kind === "taken"
          ? { kind: "taken" }
          : {
              kind: "refused",
              reason: "reason" in stored ? stored.reason : "provider was not stored",
            };
      }
      return { kind: "done", details: details(definition) };
    },
    replace: (id, definition) => {
      if (id !== definition.id)
        return { kind: "refused", reason: "provider identifier is immutable" };
      const stored = options.store.replace(id, definition);
      if (stored.kind === "unknown") return { kind: "unknown" };
      if (stored.kind !== "replaced") {
        return {
          kind: "refused",
          reason: "reason" in stored ? stored.reason : "provider was not replaced",
        };
      }
      if (!options.catalogue.replaceCustomProvider(definition, "user")) {
        conflicts.set(id, "provider identifier is already taken");
      } else {
        conflicts.delete(id);
      }
      refreshed.delete(id);
      return { kind: "done", details: details(definition) };
    },
    remove: async (id) => {
      if (options.hasActiveSession(id)) return { kind: "busy" };
      const stored = options.store.remove(id);
      if (stored.kind === "unknown") return { kind: "unknown" };
      if (stored.kind !== "removed") {
        return {
          kind: "refused",
          reason: "reason" in stored ? stored.reason : "provider was not removed",
        };
      }
      options.catalogue.removeCustomProvider(id, "user");
      await options.credentials.remove(id);
      options.catalogs.remove(id);
      conflicts.delete(id);
      refreshed.delete(id);
      return { kind: "removed", id };
    },
    refresh: async (id) => {
      const definition = options.store.find(id);
      if (definition === undefined) return { kind: "unknown" };
      const outcome = await options.catalogue.refreshProvider(id);
      const state: UserProviderRefreshState = {
        providerId: id,
        modelCount: outcome?.modelCount ?? 0,
        ...(outcome?.error === undefined ? {} : { error: outcome.error }),
        refreshedAt: new Date().toISOString(),
      };
      refreshed.set(id, state);
      return { kind: "done", details: details(definition) };
    },
  };
}
