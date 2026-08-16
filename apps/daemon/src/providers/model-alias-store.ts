/**
 * Алиасы моделей на диске (docs/model-routing.md, docs/data-directory.md).
 *
 * Устроен как сосед по каталогу — `user-provider-store.ts`: файл читается один раз при создании,
 * живёт в памяти и переписывается целиком. Негодный файл отказывает записи и не переписывается: под
 * ним список, который собрал человек, и молчаливо забыть его платформа права не имеет.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseModelAliasDraft, type ModelAlias } from "@sovereign/protocol";

import { writeFileAtomically, type Logger } from "../platform/public.ts";

export const modelAliasesFileName = "model-aliases.json";

export type ModelAliasStoreOutcome =
  | { kind: "created" | "replaced"; alias: ModelAlias }
  | { kind: "taken" | "unknown" | "identifier_changed" }
  | { kind: "removed" }
  | { kind: "refused"; reason: string };

export type ModelAliasStore = {
  list: () => ModelAlias[];
  find: (id: string) => ModelAlias | undefined;
  create: (alias: ModelAlias) => ModelAliasStoreOutcome;
  replace: (id: string, alias: ModelAlias) => ModelAliasStoreOutcome;
  remove: (id: string) => ModelAliasStoreOutcome;
  problem: () => string | undefined;
  subscribe: (listener: () => void) => () => void;
};

export function createModelAliasStore(options: {
  directory: string;
  logger: Logger;
}): ModelAliasStore {
  const path = join(options.directory, modelAliasesFileName);
  const file = readAliases(path, options.logger);
  const listeners = new Set<() => void>();
  let aliases = file.kind === "read" ? file.aliases : [];

  const refused = (): ModelAliasStoreOutcome | undefined =>
    file.kind === "refused" ? { kind: "refused", reason: file.reason } : undefined;
  const write = (next: ModelAlias[]): void => {
    writeFileAtomically(path, `${JSON.stringify({ aliases: next }, undefined, 2)}\n`);
    aliases = next;
    for (const listener of listeners) listener();
  };

  return {
    list: () => [...aliases],
    find: (id) => aliases.find((alias) => alias.id === id),
    create: (alias) => {
      const problem = refused();
      if (problem !== undefined) return problem;
      if (aliases.some((one) => one.id === alias.id)) return { kind: "taken" };
      write([...aliases, alias]);
      return { kind: "created", alias };
    },
    replace: (id, alias) => {
      const problem = refused();
      if (problem !== undefined) return problem;
      if (id !== alias.id) return { kind: "identifier_changed" };
      if (!aliases.some((one) => one.id === id)) return { kind: "unknown" };
      write(aliases.map((one) => (one.id === id ? alias : one)));
      return { kind: "replaced", alias };
    },
    remove: (id) => {
      const problem = refused();
      if (problem !== undefined) return problem;
      if (!aliases.some((one) => one.id === id)) return { kind: "unknown" };
      write(aliases.filter((one) => one.id !== id));
      return { kind: "removed" };
    },
    problem: () => (file.kind === "refused" ? file.reason : undefined),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type AliasesFile = { kind: "read"; aliases: ModelAlias[] } | { kind: "refused"; reason: string };

function readAliases(path: string, logger: Logger): AliasesFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return { kind: "read", aliases: [] };
    }
    throw cause;
  }

  const refuse = (reason: string): AliasesFile => {
    logger.error("the model aliases file was not applied and mutations will refuse", {
      file: modelAliasesFileName,
      reason,
    });
    return { kind: "refused", reason };
  };

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (cause) {
    return refuse(
      `${modelAliasesFileName} is not valid json: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const stored = objectOf(document)?.["aliases"];
  if (!Array.isArray(stored)) {
    return refuse(`${modelAliasesFileName} does not hold an alias list`);
  }

  const aliases: ModelAlias[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < stored.length; index += 1) {
    const parsed = parseModelAliasDraft(stored[index], `aliases[${String(index)}]`);
    if (parsed.kind === "rejected") return refuse(parsed.diagnostics.join("; "));
    if (seen.has(parsed.value.id)) {
      return refuse(`${modelAliasesFileName} contains duplicate alias ${parsed.value.id}`);
    }
    seen.add(parsed.value.id);
    aliases.push(parsed.value);
  }
  return { kind: "read", aliases };
}

function objectOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}
