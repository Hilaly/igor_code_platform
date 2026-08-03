import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseUserProviderDraft, type UserProviderDefinition } from "@sovereign/protocol";

import { writeFileAtomically, type Logger } from "../platform/public.ts";

export const userProvidersFileName = "user-providers.json";

export type UserProviderStoreOutcome =
  | { kind: "created" | "replaced"; definition: UserProviderDefinition }
  | { kind: "taken" | "unknown" | "identifier_changed" }
  | { kind: "removed" }
  | { kind: "refused"; reason: string };

export type UserProviderStore = {
  list: () => UserProviderDefinition[];
  find: (id: string) => UserProviderDefinition | undefined;
  create: (definition: UserProviderDefinition) => UserProviderStoreOutcome;
  replace: (id: string, definition: UserProviderDefinition) => UserProviderStoreOutcome;
  remove: (id: string) => UserProviderStoreOutcome;
  problem: () => string | undefined;
  subscribe: (listener: () => void) => () => void;
};

export function createUserProviderStore(options: {
  directory: string;
  logger: Logger;
}): UserProviderStore {
  const path = join(options.directory, userProvidersFileName);
  const file = readDefinitions(path, options.logger);
  const listeners = new Set<() => void>();
  let providers = file.kind === "read" ? file.providers : [];

  const refused = (): UserProviderStoreOutcome | undefined =>
    file.kind === "refused" ? { kind: "refused", reason: file.reason } : undefined;
  const write = (next: UserProviderDefinition[]): void => {
    writeFileAtomically(path, `${JSON.stringify({ providers: next }, undefined, 2)}\n`);
    providers = next;
    for (const listener of listeners) listener();
  };

  return {
    list: () => [...providers],
    find: (id) => providers.find((provider) => provider.id === id),
    create: (definition) => {
      const problem = refused();
      if (problem !== undefined) return problem;
      if (providers.some((provider) => provider.id === definition.id)) return { kind: "taken" };
      write([...providers, definition]);
      return { kind: "created", definition };
    },
    replace: (id, definition) => {
      const problem = refused();
      if (problem !== undefined) return problem;
      if (id !== definition.id) return { kind: "identifier_changed" };
      if (!providers.some((provider) => provider.id === id)) return { kind: "unknown" };
      write(providers.map((provider) => (provider.id === id ? definition : provider)));
      return { kind: "replaced", definition };
    },
    remove: (id) => {
      const problem = refused();
      if (problem !== undefined) return problem;
      if (!providers.some((provider) => provider.id === id)) return { kind: "unknown" };
      write(providers.filter((provider) => provider.id !== id));
      return { kind: "removed" };
    },
    problem: () => (file.kind === "refused" ? file.reason : undefined),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type DefinitionsFile =
  { kind: "read"; providers: UserProviderDefinition[] } | { kind: "refused"; reason: string };

function readDefinitions(path: string, logger: Logger): DefinitionsFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return { kind: "read", providers: [] };
    }
    throw cause;
  }

  const refuse = (reason: string): DefinitionsFile => {
    logger.error("the user providers file was not applied and mutations will refuse", {
      file: userProvidersFileName,
      reason,
    });
    return { kind: "refused", reason };
  };

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return refuse(
      `${userProvidersFileName} is not valid json: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const stored = objectOf(document)?.["providers"];
  if (!Array.isArray(stored)) {
    return refuse(`${userProvidersFileName} does not hold a provider list`);
  }

  const providers: UserProviderDefinition[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < stored.length; index += 1) {
    const parsed = parseUserProviderDraft(stored[index], `providers[${index}]`);
    if (parsed.kind === "rejected") return refuse(parsed.diagnostics.join("; "));
    if (seen.has(parsed.value.id)) {
      return refuse(`${userProvidersFileName} contains duplicate provider ${parsed.value.id}`);
    }
    seen.add(parsed.value.id);
    providers.push(parsed.value);
  }
  return { kind: "read", providers };
}

function objectOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}
