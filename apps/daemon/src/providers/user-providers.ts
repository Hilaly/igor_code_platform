import type { ProviderCatalogue } from "@sovereign/agent-runtime-pi";
import type {
  UserProviderDefinition,
  UserProviderDetails,
  UserProviderRefreshState,
} from "@sovereign/protocol";

import type { CredentialStore } from "./credential-store.ts";
import type { ModelCatalogStore } from "./model-catalog-store.ts";
import type { UserProviderStore } from "./user-provider-store.ts";
import type { ProviderLogins } from "./provider-logins.ts";

export type UserProviderOutcome =
  | { kind: "done"; details: UserProviderDetails }
  | { kind: "removed"; id: string }
  | { kind: "unknown" }
  | { kind: "taken" }
  | { kind: "busy" }
  | { kind: "refused"; reason: string };

export type UserProviders = {
  list: () => UserProviderDetails[];
  problem: () => string | undefined;
  ready: () => Promise<void>;
  find: (id: string) => UserProviderDetails | undefined;
  create: (definition: UserProviderDefinition) => Promise<UserProviderOutcome>;
  replace: (id: string, definition: UserProviderDefinition) => Promise<UserProviderOutcome>;
  remove: (id: string) => Promise<UserProviderOutcome>;
  refresh: (id: string) => Promise<UserProviderOutcome>;
};

export function createUserProviders(options: {
  store: UserProviderStore;
  catalogue: ProviderCatalogue;
  credentials: Pick<CredentialStore, "read" | "modify" | "remove">;
  catalogs: Pick<ModelCatalogStore, "read" | "write" | "remove">;
  logins: Pick<ProviderLogins, "runningFor" | "cancel">;
  hasActiveSession: (providerId: string) => boolean;
}): UserProviders {
  const conflicts = new Map<string, string>();
  const refreshed = new Map<string, UserProviderRefreshState>();
  let mutation = Promise.resolve<unknown>(undefined);
  const providerQueues = new Map<string, Promise<unknown>>();
  const enqueue = <Result>(step: () => Promise<Result>): Promise<Result> => {
    const next = mutation.then(step, step);
    mutation = next.catch(() => undefined);
    return next;
  };
  const enqueueProvider = <Result>(
    providerId: string,
    step: () => Promise<Result>,
  ): Promise<Result> => {
    const previous = providerQueues.get(providerId) ?? Promise.resolve();
    const next = previous.then(step, step);
    providerQueues.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  };
  const restorations: Promise<unknown>[] = [];

  for (const definition of options.store.list()) {
    const outcome = options.catalogue.setCustomProvider(definition, "user");
    if (outcome.kind === "taken")
      conflicts.set(definition.id, "provider identifier is already taken");
    else restorations.push(options.catalogue.restoreProvider(definition.id, "user"));
  }

  const details = (definition: UserProviderDefinition): UserProviderDetails => ({
    definition,
    ...(conflicts.has(definition.id) ? { conflict: conflicts.get(definition.id) } : {}),
    ...(refreshed.has(definition.id) ? { refresh: refreshed.get(definition.id) } : {}),
  });

  return {
    list: () => options.store.list().map(details),
    problem: options.store.problem,
    ready: async () => void (await Promise.all(restorations)),
    find: (id) => {
      const definition = options.store.find(id);
      return definition === undefined ? undefined : details(definition);
    },
    create: (definition) =>
      enqueueProvider(definition.id, () =>
        enqueue(async () => {
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
          await options.catalogue.restoreProvider(definition.id, "user");
          return { kind: "done", details: details(definition) };
        }),
      ),
    replace: (id, definition) =>
      enqueueProvider(id, () =>
        enqueue(async () => {
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
          await options.catalogue.restoreProvider(id, "user");
          return { kind: "done", details: details(definition) };
        }),
      ),
    remove: (id) =>
      enqueueProvider(id, () =>
        enqueue(async () => {
          if (options.hasActiveSession(id)) return { kind: "busy" };
          const definition = options.store.find(id);
          if (definition === undefined) return { kind: "unknown" };
          const running = options.logins.runningFor(id);
          if (running !== undefined) options.logins.cancel(running.attemptId);
          const credential = await options.credentials.read(id);
          const catalog = options.catalogs.read(id);
          options.catalogue.removeCustomProvider(id, "user");
          try {
            await options.credentials.remove(id);
            options.catalogs.remove(id);
            const stored = options.store.remove(id);
            if (stored.kind !== "removed")
              throw new Error("reason" in stored ? stored.reason : "provider was not removed");
          } catch (cause) {
            if (credential !== undefined)
              await options.credentials.modify(id, async () => credential).catch(() => undefined);
            if (catalog !== undefined) {
              try {
                options.catalogs.write(id, catalog);
              } catch {
                // Каждый компенсирующий шаг best-effort и не мешает следующим.
              }
            }
            try {
              if (options.catalogue.setCustomProvider(definition, "user").kind === "registered")
                await options.catalogue.restoreProvider(id, "user").catch(() => undefined);
            } catch {
              // Типизированный отказ важнее второй ошибки отката; restart поднимет definition снова.
            }
            return {
              kind: "refused",
              reason: cause instanceof Error ? cause.message : String(cause),
            };
          }
          conflicts.delete(id);
          refreshed.delete(id);
          return { kind: "removed", id };
        }),
      ),
    refresh: (id) =>
      enqueueProvider(id, async () => {
        const definition = options.store.find(id);
        if (definition === undefined) return { kind: "unknown" };
        if (options.catalogue.customProviderOrigin(id) !== "user") return { kind: "taken" };
        const outcome = await options.catalogue.refreshProvider(id, undefined, "user");
        const state: UserProviderRefreshState = {
          providerId: id,
          modelCount: outcome?.modelCount ?? 0,
          ...(outcome?.error === undefined ? {} : { error: outcome.error }),
          refreshedAt: new Date().toISOString(),
        };
        refreshed.set(id, state);
        return { kind: "done", details: details(definition) };
      }),
  };
}
