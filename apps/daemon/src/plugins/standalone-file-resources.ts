import type { ContributionRegistration } from "@sovereign/protocol";
import { lstatSync } from "node:fs";

import type { Logger } from "../platform/public.ts";
import type {
  ContributionRegistry,
  FileContributionInput,
  StandaloneContributionSnapshot,
} from "./contribution-registry.ts";
import { discoverFileResources, type DiscoveredFileResource } from "./file-resource-discovery.ts";
import {
  createFileResourceWatcher,
  type CreateFileResourceWatcherOptions,
  type FileResourceWatcher,
} from "./file-resource-watcher.ts";
import type { FileResourceDefinition } from "./file-resource-parser.ts";
import type { StandaloneResourceRoot } from "./file-resource-roots.ts";

export type StandaloneFileResourceService = {
  start: () => Promise<void>;
  rescan: (options?: { resourceChanged?: boolean }) => Promise<void>;
  rearm: (roots: StandaloneResourceRoot[]) => Promise<void>;
  close: () => void;
};

export type CreateStandaloneFileResourceServiceOptions = {
  roots: StandaloneResourceRoot[];
  registry: ContributionRegistry;
  logger: Logger;
  /** Общая инвалидация контекстных вкладов; вызывается после атомарного применения scan. */
  publishContributionChanges?: () => void;
  createWatcher?: (options: CreateFileResourceWatcherOptions) => FileResourceWatcher;
};

export function createStandaloneFileResourceService(
  options: CreateStandaloneFileResourceServiceOptions,
): StandaloneFileResourceService {
  let roots = options.roots;
  let appliedRootKeys = new Set<string>();
  let scans = Promise.resolve();
  const watcher = (options.createWatcher ?? createFileResourceWatcher)({
    roots,
    logger: options.logger,
    onChange: () => {
      void rescan({ resourceChanged: true }).catch((cause: unknown) => {
        options.logger.error("rescanning standalone file resources failed", {
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      });
    },
  });

  const mutateRegistry = (mutation: () => void): void => {
    const revision = options.registry.revision();
    mutation();

    if (options.registry.revision() !== revision) {
      options.publishContributionChanges?.();
    }
  };

  const scan = (scanOptions?: { resourceChanged?: boolean }): void => {
    const revision = options.registry.revision();
    const nextKeys = new Set(roots.map((root) => root.key));

    for (const root of roots) {
      mutateRegistry(() => options.registry.applyStandalone(snapshot(root)));
    }
    for (const key of appliedRootKeys) {
      if (!nextKeys.has(key)) mutateRegistry(() => options.registry.removeStandalone(key));
    }
    appliedRootKeys = nextKeys;

    // Обычная scan меняет revision только вместе со снимком. Реальное watcher-событие обязано
    // быть заметно и при неизменном parsed entry, но ровно один раз за debounced callback.
    if (scanOptions?.resourceChanged === true && options.registry.revision() === revision) {
      const first = roots[0];
      if (first !== undefined)
        mutateRegistry(() =>
          options.registry.applyStandalone(snapshot(first), { resourceChanged: true }),
        );
    }
  };

  const rescan = (scanOptions?: { resourceChanged?: boolean }): Promise<void> => {
    const pending = scans.then(() => scan(scanOptions));
    scans = pending.catch(() => {});
    return pending;
  };

  return {
    start: async () => {
      watcher.start();
      await rescan();
    },
    rescan,
    rearm: async (next) => {
      roots = next;
      watcher.rearm(next);
      await rescan();
    },
    close: () => watcher.close(),
  };
}

function snapshot(root: StandaloneResourceRoot): StandaloneContributionSnapshot {
  const rootStat = lstatSync(root.directory, { throwIfNoEntry: false });
  const contributions =
    rootStat === undefined || rootStat.isSymbolicLink() || !rootStat.isDirectory()
      ? []
      : discoverFileResources({ kind: root.kind, root: root.directory }).map((resource) =>
          fileContribution(root, resource),
        );
  const common = {
    rootKey: root.key,
    source: root.source,
    precedence: root.precedence,
    contributions,
  };
  return root.scope === "project"
    ? { ...common, scope: "project", projectId: root.projectId as string }
    : { ...common, scope: "user" };
}

function fileContribution(
  root: StandaloneResourceRoot,
  resource: DiscoveredFileResource,
): FileContributionInput {
  if (resource.parsed.kind === "invalid") {
    return {
      path: resource.entryPath,
      kind: root.kind,
      diagnostics: resource.parsed.diagnostics,
    };
  }
  const definition = resource.parsed.definition;
  return {
    path: resource.entryPath,
    kind: definition.kind,
    diagnostics: resource.parsed.diagnostics,
    id: definition.name,
    name: definition.name,
    description: definition.description,
    registration: registration(root, definition),
  };
}

function registration(
  root: StandaloneResourceRoot,
  definition: FileResourceDefinition,
): Extract<ContributionRegistration, { kind: "agent" | "skill" }> {
  const common = {
    ownership: "standalone" as const,
    id: definition.name,
    declaredId: definition.name,
    source: root.source,
    scope: root.scope,
    ...(root.projectId === undefined ? {} : { projectId: root.projectId }),
    description: definition.description,
  };
  if (definition.kind === "agent") {
    return {
      ...common,
      kind: "agent",
      instructions: definition.instructions,
      tools: definition.tools,
      skills: definition.skills,
      ...(definition.model === undefined ? {} : { model: definition.model }),
      ...(definition.thinkingLevel === undefined
        ? {}
        : { thinkingLevel: definition.thinkingLevel }),
    };
  }
  return {
    ...common,
    kind: "skill",
    name: definition.name,
    location: definition.location,
    ...(definition.license === undefined ? {} : { license: definition.license }),
    ...(definition.compatibility === undefined ? {} : { compatibility: definition.compatibility }),
    ...(definition.metadata === undefined ? {} : { metadata: definition.metadata }),
    ...(definition.allowedTools === undefined ? {} : { allowedTools: definition.allowedTools }),
    disableModelInvocation: definition.disableModelInvocation,
  };
}
