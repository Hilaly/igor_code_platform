/**
 * Единый реестр объявлений вкладов (docs/plugins.md). Loader плагинов и standalone-сервис заменяют
 * здесь атомарные снимки своих владельцев, а потребители разрешают один и тот же набор в базовом
 * контексте или в контексте проекта.
 */

import { isRuntimeHookName } from "@sovereign/agent-runtime-pi";
import {
  coreEventNamespace,
  isHookCriticality,
  isPluginRouteMethod,
  isSubscribablePlatformHook,
  isThinkingLevel,
  pluginSourceRank,
  type ContributionConflict,
  type ContributionKind,
  type ContributionRegistration,
  type FileResourceDiagnostic,
  type FileResourceKind,
  type FileResourcesSnapshot,
  type FileResourceSummary,
  type PluginSource,
} from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

type PluginContributionRegistration = Extract<ContributionRegistration, { ownership: "plugin" }>;

/** Точки в идентификаторе разрешены: они дают плагину свою иерархию внутри своего неймспейса. */
const declaredIdPattern = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

/**
 * У инструмента идентификатор строже общего: он же имя, которым его зовёт модель, а провайдеры
 * принимают в имени инструмента только `[A-Za-z0-9_-]` и не длиннее 64 символов. Поэтому точка,
 * законная в остальных идентификаторах, здесь запрещена (docs/plugins.md).
 */
const toolNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Сегмент пути маршрута плагина: обычный или `:имя` — его значение уезжает в параметры запроса.
 * Пустой сегмент, `.` и `..` не проходят, поэтому объявленный путь не выходит за свой префикс
 * (docs/web-api.md).
 */
const routeSegmentPattern = /^:?[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type ContributionApplyOutcome = {
  registered: ContributionRegistration[];
  /** Кривой вклад — событие жизненного цикла плагина, а не исключение (docs/plugins.md). */
  problems: string[];
};

export type ContributingPlugin = {
  key: string;
  id: string;
  source: PluginSource;
};

export type FileContributionInput = {
  path: string;
  kind: FileResourceKind;
  diagnostics: FileResourceDiagnostic[];
  registration?: Extract<ContributionRegistration, { kind: "agent" | "skill" }>;
  /** Для invalid-файла registration нет, но диагностическому снимку всё ещё нужны эти поля. */
  id?: string;
  name?: string;
  description?: string;
};

export type PluginContributionSnapshot = {
  plugin: ContributingPlugin;
  contributions: PluginContribution[];
  fileContributions: FileContributionInput[];
  disabledContributions: ReadonlySet<string>;
};

type StandaloneContributionSnapshotCommon = {
  rootKey: string;
  source: string;
  precedence: number;
  contributions: FileContributionInput[];
};

export type StandaloneContributionSnapshot = StandaloneContributionSnapshotCommon &
  ({ scope: "user"; projectId?: never } | { scope: "project"; projectId: string });

type ApplyOptions = { resourceChanged?: boolean };

export type ContributionRegistry = {
  revision: () => number;
  applyPlugin: {
    (input: PluginContributionSnapshot, options?: ApplyOptions): ContributionApplyOutcome;
    (
      plugin: ContributingPlugin,
      contributions: PluginContribution[],
      disabledContributions: ReadonlySet<string>,
      options?: ApplyOptions,
    ): ContributionApplyOutcome;
  };
  applyStandalone: (input: StandaloneContributionSnapshot, options?: ApplyOptions) => void;
  removePlugin: (pluginKey: string) => void;
  removeStandalone: (rootKey: string) => void;
  resolvedBase: (kind?: ContributionKind) => ContributionRegistration[];
  resolvedForProject: (projectId: string, kind?: ContributionKind) => ContributionRegistration[];
  fileResourcesForProject: (projectId: string) => FileResourcesSnapshot;
  switchedOff: () => ContributionRegistration[];
  conflictsForProject: (projectId: string) => ContributionConflict[];
  /** Административный union активных plugin-owned вкладов по всем контекстам. */
  pluginContributions: () => ContributionRegistration[];

  /** Совместимые имена для текущих потребителей; новые context consumers их не используют. */
  apply: (
    plugin: ContributingPlugin,
    contributions: PluginContribution[],
    disabledContributions: ReadonlySet<string>,
  ) => ContributionApplyOutcome;
  remove: (pluginKey: string) => void;
  resolved: () => PluginContributionRegistration[];
  conflicts: () => ContributionConflict[];
};

type ContributionDeclaration = {
  key: string;
  identity: string;
  registration: ContributionRegistration;
  source: string;
  scope: "built-in" | "user" | "project";
  projectId?: string;
  precedence: number;
  ownership:
    { kind: "plugin"; pluginKey: string; pluginId: string } | { kind: "standalone"; root: string };
  file?: {
    path: string;
    diagnostics: FileResourceDiagnostic[];
  };
  enabled: boolean;
};

type InvalidFileDeclaration = {
  key: string;
  source: string;
  scope: "built-in" | "user" | "project";
  projectId?: string;
  ownership:
    { kind: "plugin"; pluginKey: string; pluginId: string } | { kind: "standalone"; root: string };
  file: FileContributionInput;
};

type OwnershipSnapshot = {
  declarations: ContributionDeclaration[];
  invalidFiles: InvalidFileDeclaration[];
};

type Resolution = {
  registrations: ContributionRegistration[];
  declarations: ContributionDeclaration[];
  conflictedDeclarations: ContributionDeclaration[];
  conflicts: ContributionConflict[];
};

const byRegistration = (left: ContributionRegistration, right: ContributionRegistration): number =>
  `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`, "en");

const pluginScope = (
  source: PluginSource,
): { scope: "built-in" | "user" | "project"; projectId?: string } => {
  if (source === "builtin") {
    return { scope: "built-in" };
  }
  if (source === "data") {
    return { scope: "user" };
  }
  return { scope: "project", projectId: source.slice("project:".length) };
};

export function createContributionRegistry(): ContributionRegistry {
  const pluginSnapshots = new Map<string, OwnershipSnapshot>();
  const standaloneSnapshots = new Map<string, OwnershipSnapshot>();
  let revision = 0;
  let observableState = serializeState(pluginSnapshots, standaloneSnapshots);

  const finishMutation = (resourceChanged = false): void => {
    const next = serializeState(pluginSnapshots, standaloneSnapshots);
    if (resourceChanged || next !== observableState) {
      revision += 1;
    }
    observableState = next;
  };

  const declarations = (): ContributionDeclaration[] => [
    ...[...pluginSnapshots.values()].flatMap((snapshot) => snapshot.declarations),
    ...[...standaloneSnapshots.values()].flatMap((snapshot) => snapshot.declarations),
  ];

  const invalidFiles = (): InvalidFileDeclaration[] => [
    ...[...pluginSnapshots.values()].flatMap((snapshot) => snapshot.invalidFiles),
    ...[...standaloneSnapshots.values()].flatMap((snapshot) => snapshot.invalidFiles),
  ];

  const resolve = (projectId?: string): Resolution => {
    const applicable = declarations().filter(
      (declaration) =>
        declaration.enabled &&
        (declaration.scope !== "project" ||
          (projectId !== undefined && declaration.projectId === projectId)),
    );
    const claims = new Map<string, ContributionDeclaration[]>();

    for (const declaration of applicable) {
      claims.set(declaration.identity, [...(claims.get(declaration.identity) ?? []), declaration]);
    }

    const winners: ContributionDeclaration[] = [];
    const conflictedDeclarations: ContributionDeclaration[] = [];
    const conflicts: ContributionConflict[] = [];

    for (const [, claimants] of [...claims].sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    )) {
      const best = Math.max(...claimants.map((claimant) => claimant.precedence));
      const leading = claimants.filter((claimant) => claimant.precedence === best);
      const winner = leading[0];

      if (leading.length > 1) {
        const pluginClaims = leading.filter((claimant) => claimant.ownership.kind === "plugin");
        const standaloneClaims = leading.filter(
          (claimant) => claimant.ownership.kind === "standalone",
        );
        const first = leading[0];
        conflictedDeclarations.push(...leading);
        if (first !== undefined) {
          conflicts.push({
            id: first.registration.id,
            source: first.registration.source,
            plugins: pluginClaims.map((claimant) =>
              claimant.ownership.kind === "plugin" ? claimant.ownership.pluginKey : "",
            ),
            ...(standaloneClaims.length === 0
              ? {}
              : {
                  standaloneRoots: standaloneClaims.map((claimant) =>
                    claimant.ownership.kind === "standalone" ? claimant.ownership.root : "",
                  ),
                }),
          });
        }
        continue;
      }

      if (winner !== undefined) {
        winners.push(winner);
      }
    }

    return {
      declarations: winners,
      conflictedDeclarations,
      registrations: winners.map((winner) => winner.registration).sort(byRegistration),
      conflicts,
    };
  };

  const applyPlugin: ContributionRegistry["applyPlugin"] = (
    input: PluginContributionSnapshot | ContributingPlugin,
    contributionsOrOptions?: PluginContribution[] | ApplyOptions,
    disabledContributions?: ReadonlySet<string>,
    legacyOptions?: ApplyOptions,
  ): ContributionApplyOutcome => {
    const snapshot: PluginContributionSnapshot =
      "plugin" in input
        ? input
        : {
            plugin: input,
            contributions: contributionsOrOptions as PluginContribution[],
            fileContributions: [],
            disabledContributions: disabledContributions ?? new Set(),
          };
    const options = ("plugin" in input ? contributionsOrOptions : legacyOptions) as
      ApplyOptions | undefined;
    const built = buildPluginSnapshot(snapshot);

    pluginSnapshots.set(snapshot.plugin.key, built.snapshot);
    finishMutation(options?.resourceChanged === true);
    return built.outcome;
  };

  const pluginContributions = (): ContributionRegistration[] => {
    const projectIds = new Set(
      declarations()
        .filter((declaration) => declaration.scope === "project")
        .map((declaration) => declaration.projectId)
        .filter((projectId): projectId is string => projectId !== undefined),
    );
    const contexts = [resolve(), ...[...projectIds].sort().map((projectId) => resolve(projectId))];
    const selected = new Map<string, ContributionDeclaration>();

    for (const context of contexts) {
      for (const declaration of context.declarations) {
        if (declaration.ownership.kind === "plugin") {
          selected.set(declaration.key, declaration);
        }
      }
    }

    return [...selected.values()]
      .map((declaration) => declaration.registration)
      .sort(byRegistration);
  };

  const conflictsAcrossContexts = (): ContributionConflict[] => {
    const projectIds = new Set(
      declarations()
        .map((declaration) => declaration.projectId)
        .filter((projectId): projectId is string => projectId !== undefined),
    );
    const conflicts = [
      ...resolve().conflicts,
      ...[...projectIds].flatMap((projectId) => resolve(projectId).conflicts),
    ];
    const unique = new Map(conflicts.map((conflict) => [JSON.stringify(conflict), conflict]));
    return [...unique.values()].filter((conflict) => conflict.plugins.length > 0);
  };

  return {
    revision: () => revision,
    applyPlugin,
    applyStandalone: (input, options) => {
      standaloneSnapshots.set(input.rootKey, buildStandaloneSnapshot(input));
      finishMutation(options?.resourceChanged === true);
    },
    removePlugin: (pluginKey) => {
      if (pluginSnapshots.delete(pluginKey)) {
        finishMutation();
      }
    },
    removeStandalone: (rootKey) => {
      if (standaloneSnapshots.delete(rootKey)) {
        finishMutation();
      }
    },
    resolvedBase: (kind) => filterKind(resolve().registrations, kind),
    resolvedForProject: (projectId, kind) => filterKind(resolve(projectId).registrations, kind),
    fileResourcesForProject: (projectId) =>
      fileResourcesSnapshot(
        revision,
        projectId,
        declarations(),
        invalidFiles(),
        resolve(projectId),
      ),
    switchedOff: () =>
      declarations()
        .filter((declaration) => !declaration.enabled)
        .map((declaration) => declaration.registration)
        .sort(byRegistration),
    conflictsForProject: (projectId) => resolve(projectId).conflicts,
    pluginContributions,
    apply: (plugin, contributions, disabled) => applyPlugin(plugin, contributions, disabled),
    remove: (pluginKey) => {
      if (pluginSnapshots.delete(pluginKey)) {
        finishMutation();
      }
    },
    resolved: () => pluginContributions() as PluginContributionRegistration[],
    conflicts: conflictsAcrossContexts,
  };
}

function buildPluginSnapshot(input: PluginContributionSnapshot): {
  snapshot: OwnershipSnapshot;
  outcome: ContributionApplyOutcome;
} {
  const { plugin } = input;
  const origin = pluginScope(plugin.source);
  const ownership = { kind: "plugin" as const, pluginKey: plugin.key, pluginId: plugin.id };
  const claims = new Map<string, ContributionDeclaration[]>();
  const invalidFiles: InvalidFileDeclaration[] = [];
  const problems: string[] = [];

  input.contributions.forEach((contribution, index) => {
    const registration = programmaticRegistration(plugin, contribution, problems);
    if (registration === undefined) {
      return;
    }
    addClaim(
      claims,
      declarationOf({
        registration,
        claimKey: `plugin:${plugin.key}:programmatic:${index}`,
        origin,
        precedence: pluginSourceRank(plugin.source),
        ownership,
        enabled: !input.disabledContributions.has(registration.id),
      }),
    );
  });

  input.fileContributions.forEach((file, index) => {
    if (file.registration === undefined) {
      invalidFiles.push({
        key: `plugin:${plugin.key}:invalid:${index}:${file.path}`,
        source: plugin.source,
        ...origin,
        ownership,
        file,
      });
      return;
    }
    const registration = file.registration;
    addClaim(
      claims,
      declarationOf({
        registration,
        claimKey: `plugin:${plugin.key}:file:${file.path}`,
        origin,
        precedence: pluginSourceRank(plugin.source),
        ownership,
        file: { path: file.path, diagnostics: file.diagnostics },
        enabled: !input.disabledContributions.has(registration.id),
      }),
    );
  });

  const declarations: ContributionDeclaration[] = [];
  for (const [identity, group] of [...claims].sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  )) {
    const single = group[0];
    if (group.length !== 1 || single === undefined) {
      const fileClaim = group.find((declaration) => declaration.file !== undefined);
      problems.push(
        `the contribution ${identity.slice(identity.indexOf(":") + 1)} is declared ${group.length} times by one plugin`,
      );
      if (fileClaim?.file !== undefined) {
        invalidFiles.push({
          key: `plugin:${plugin.key}:conflict:${identity}:${fileClaim.file.path}`,
          source: plugin.source,
          ...origin,
          ownership,
          file: {
            path: fileClaim.file.path,
            kind: fileClaim.registration.kind as FileResourceKind,
            id: fileClaim.registration.id,
            name:
              fileClaim.registration.kind === "skill"
                ? fileClaim.registration.name
                : fileClaim.registration.declaredId,
            description: fileClaim.registration.description,
            diagnostics: [
              ...fileClaim.file.diagnostics,
              {
                severity: "error",
                code: "duplicate-contribution",
                message: `the ${fileClaim.registration.kind} ${fileClaim.registration.id} is also declared programmatically by this plugin`,
                path: fileClaim.file.path,
                kind: fileClaim.registration.kind as FileResourceKind,
                id: fileClaim.registration.id,
              },
            ],
          },
        });
      }
      continue;
    }
    declarations.push(single);
  }

  return {
    snapshot: { declarations, invalidFiles },
    outcome: {
      registered: declarations
        .filter((declaration) => declaration.enabled)
        .map((declaration) => declaration.registration)
        .sort(byRegistration),
      problems,
    },
  };
}

function buildStandaloneSnapshot(input: StandaloneContributionSnapshot): OwnershipSnapshot {
  const ownership = { kind: "standalone" as const, root: input.rootKey };
  const origin =
    input.scope === "project"
      ? { scope: "project" as const, projectId: input.projectId }
      : { scope: "user" as const };
  const declarations: ContributionDeclaration[] = [];
  const invalidFiles: InvalidFileDeclaration[] = [];

  input.contributions.forEach((file, index) => {
    if (file.registration === undefined) {
      invalidFiles.push({
        key: `standalone:${input.rootKey}:invalid:${index}:${file.path}`,
        source: input.source,
        ...origin,
        ownership,
        file,
      });
      return;
    }
    declarations.push(
      declarationOf({
        registration: file.registration,
        claimKey: `standalone:${input.rootKey}:file:${file.path}`,
        origin,
        precedence: input.precedence,
        ownership,
        file: { path: file.path, diagnostics: file.diagnostics },
        enabled: true,
      }),
    );
  });

  return { declarations, invalidFiles };
}

function declarationOf(input: {
  registration: ContributionRegistration;
  claimKey: string;
  origin: { scope: "built-in" | "user" | "project"; projectId?: string };
  precedence: number;
  ownership: ContributionDeclaration["ownership"];
  file?: ContributionDeclaration["file"];
  enabled: boolean;
}): ContributionDeclaration {
  const identity = `${input.registration.kind}:${input.registration.id}`;
  return {
    key: `${identity}:${input.claimKey}`,
    identity,
    registration: input.registration,
    source: input.registration.source,
    ...input.origin,
    precedence: input.precedence,
    ownership: input.ownership,
    ...(input.file === undefined ? {} : { file: input.file }),
    enabled: input.enabled,
  };
}

function addClaim(
  claims: Map<string, ContributionDeclaration[]>,
  declaration: ContributionDeclaration,
): void {
  claims.set(declaration.identity, [...(claims.get(declaration.identity) ?? []), declaration]);
}

function filterKind(
  registrations: ContributionRegistration[],
  kind?: ContributionKind,
): ContributionRegistration[] {
  return kind === undefined
    ? registrations
    : registrations.filter((registration) => registration.kind === kind);
}

function fileResourcesSnapshot(
  revision: number,
  projectId: string,
  declarations: ContributionDeclaration[],
  invalidFiles: InvalidFileDeclaration[],
  resolution: Resolution,
): FileResourcesSnapshot {
  const active = new Set(resolution.declarations.map((declaration) => declaration.key));
  const conflicted = new Set(
    resolution.conflictedDeclarations.map((declaration) => declaration.key),
  );
  const applicable = declarations.filter(
    (declaration) =>
      declaration.file !== undefined &&
      (declaration.scope !== "project" || declaration.projectId === projectId),
  );
  const applicableInvalid = invalidFiles.filter(
    (declaration) => declaration.scope !== "project" || declaration.projectId === projectId,
  );
  const resources: FileResourceSummary[] = [
    ...applicable.map((declaration) => {
      const registration = declaration.registration;
      const file = declaration.file as NonNullable<ContributionDeclaration["file"]>;
      return {
        kind: registration.kind as FileResourceKind,
        name: registration.kind === "skill" ? registration.name : registration.declaredId,
        id: registration.id,
        ownership: declaration.ownership.kind,
        scope: declaration.scope,
        source: declaration.source,
        path: file.path,
        state: !declaration.enabled
          ? "switched-off"
          : conflicted.has(declaration.key)
            ? "invalid"
            : active.has(declaration.key)
              ? "active"
              : "shadowed",
        ...(declaration.ownership.kind === "plugin"
          ? { pluginKey: declaration.ownership.pluginKey }
          : {}),
        ...(registration.description === undefined
          ? {}
          : { description: registration.description }),
      } satisfies FileResourceSummary;
    }),
    ...applicableInvalid.map((declaration) => ({
      kind: declaration.file.kind,
      ...(declaration.file.name === undefined ? {} : { name: declaration.file.name }),
      ...(declaration.file.id === undefined ? {} : { id: declaration.file.id }),
      ownership: declaration.ownership.kind,
      scope: declaration.scope,
      source: declaration.source,
      path: declaration.file.path,
      state: "invalid" as const,
      ...(declaration.ownership.kind === "plugin"
        ? { pluginKey: declaration.ownership.pluginKey }
        : {}),
      ...(declaration.file.description === undefined
        ? {}
        : { description: declaration.file.description }),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const diagnostics = [
    ...applicable.flatMap((declaration) => declaration.file?.diagnostics ?? []),
    ...resolution.conflictedDeclarations.flatMap((declaration) =>
      declaration.file === undefined
        ? []
        : [
            {
              severity: "error" as const,
              code: "duplicate-contribution",
              message: `the ${declaration.registration.kind} ${declaration.registration.id} is claimed by equal-precedence sources`,
              path: declaration.file.path,
              kind: declaration.registration.kind as FileResourceKind,
              id: declaration.registration.id,
            },
          ],
    ),
    ...applicableInvalid.flatMap((declaration) => declaration.file.diagnostics),
  ].sort((left, right) =>
    `${left.path}:${left.code}:${left.message}`.localeCompare(
      `${right.path}:${right.code}:${right.message}`,
      "en",
    ),
  );

  return { revision, resources, diagnostics };
}

function serializeState(
  pluginSnapshots: Map<string, OwnershipSnapshot>,
  standaloneSnapshots: Map<string, OwnershipSnapshot>,
): string {
  const normalize = (snapshots: Map<string, OwnershipSnapshot>) =>
    [...snapshots]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, snapshot]) => [
        key,
        {
          declarations: [...snapshot.declarations].sort((left, right) =>
            left.key.localeCompare(right.key, "en"),
          ),
          invalidFiles: [...snapshot.invalidFiles].sort((left, right) =>
            left.key.localeCompare(right.key, "en"),
          ),
        },
      ]);
  return JSON.stringify({
    plugins: normalize(pluginSnapshots),
    standalone: normalize(standaloneSnapshots),
  });
}

function programmaticRegistration(
  plugin: ContributingPlugin,
  contribution: PluginContribution,
  problems: string[],
): PluginContributionRegistration | undefined {
  if (!declaredIdPattern.test(contribution.id)) {
    problems.push(
      `the contribution identifier ${JSON.stringify(contribution.id)} must match ${declaredIdPattern.source}`,
    );
    return undefined;
  }

  const id = `${plugin.id}.${contribution.id}`;
  if (contribution.kind === "event" && id.startsWith(`${coreEventNamespace}.`)) {
    problems.push(`the event ${id} is in the namespace of the core, which belongs to the platform`);
    return undefined;
  }

  const common = {
    ownership: "plugin" as const,
    id,
    declaredId: contribution.id,
    pluginKey: plugin.key,
    pluginId: plugin.id,
    source: plugin.source,
    ...(contribution.title === undefined ? {} : { title: contribution.title }),
    ...(contribution.description === undefined ? {} : { description: contribution.description }),
  };

  if (contribution.kind === "event") {
    return { ...common, kind: "event", payloadSchema: contribution.payloadSchema };
  }
  if (contribution.kind === "custom") {
    return {
      ...common,
      kind: "custom",
      ...(contribution.payload === undefined ? {} : { payload: contribution.payload }),
    };
  }

  if (contribution.kind === "hook") {
    if (!isRuntimeHookName(contribution.event) && !isSubscribablePlatformHook(contribution.event)) {
      // Незнакомое имя — проблема жизненного цикла, а не исключение: остальные вклады плагина
      // применяются, а причина видна в интерфейсе (docs/plugins.md).
      problems.push(
        `the subscription ${id} names an unknown hook ${JSON.stringify(contribution.event)}`,
      );
      return undefined;
    }
    if (contribution.criticality !== undefined && !isHookCriticality(contribution.criticality)) {
      problems.push(
        `the subscription ${id} names an unknown criticality ${JSON.stringify(contribution.criticality)}`,
      );
      return undefined;
    }

    return {
      ...common,
      kind: "hook",
      event: contribution.event,
      // Не сказано — некритичная: критичность по умолчанию значила бы, что забывший пометку автор
      // роняет турны (docs/hooks.md).
      criticality: contribution.criticality ?? "advisory",
    };
  }

  if (contribution.kind === "tool") {
    if (!toolNamePattern.test(contribution.id)) {
      problems.push(
        `the tool ${id} must be named ${toolNamePattern.source}: the identifier is the name the model calls`,
      );
      return undefined;
    }

    const description =
      typeof contribution.description === "string" ? contribution.description.trim() : "";
    if (description === "") {
      problems.push(`the tool ${id} declares no description, so the model cannot use it`);
      return undefined;
    }
    if (typeof contribution.parameters !== "object" || contribution.parameters === null) {
      problems.push(`the tool ${id} must declare the schema of its arguments`);
      return undefined;
    }

    return { ...common, kind: "tool", description, parameters: contribution.parameters };
  }

  if (contribution.kind === "route" || contribution.kind === "public-route") {
    if (!isPluginRouteMethod(contribution.method)) {
      problems.push(
        `the route ${id} names an unknown method ${JSON.stringify(contribution.method)}`,
      );
      return undefined;
    }

    const path = normalizeRoutePath(contribution.path);

    if (path === undefined) {
      problems.push(
        `the route ${id} must declare a path of segments matching ${routeSegmentPattern.source}, got ${JSON.stringify(contribution.path)}`,
      );
      return undefined;
    }

    return { ...common, kind: contribution.kind, method: contribution.method, path };
  }

  const instructions =
    typeof contribution.instructions === "string" ? contribution.instructions.trim() : "";
  if (instructions === "") {
    problems.push(`the agent ${id} declares no instructions`);
    return undefined;
  }

  const include = selectionPart(contribution.tools, "include", []);
  const exclude = selectionPart(contribution.tools, "exclude", []);
  if (include === undefined || exclude === undefined) {
    problems.push(`the agent ${id} must select tools by lists of name patterns`);
    return undefined;
  }
  if (contribution.thinkingLevel !== undefined && !isThinkingLevel(contribution.thinkingLevel)) {
    problems.push(
      `the agent ${id} names an unknown reasoning level ${JSON.stringify(contribution.thinkingLevel)}`,
    );
    return undefined;
  }

  const skillInclude = selectionPart(contribution.skills, "include", []);
  const skillExclude = selectionPart(contribution.skills, "exclude", []);
  if (skillInclude === undefined || skillExclude === undefined) {
    problems.push(`the agent ${id} must select skills by lists of name patterns`);
    return undefined;
  }

  return {
    ...common,
    kind: "agent",
    instructions,
    tools: { include, exclude },
    ...(contribution.model === undefined ? {} : { model: contribution.model }),
    ...(contribution.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: contribution.thinkingLevel }),
    skills: { include: skillInclude, exclude: skillExclude },
  };
}

/**
 * Приводит объявленный путь к виду таблицы: без ведущего и хвостового слэша, сегментами. Путь
 * пустой — это адрес самого плагина (`/p/<id>/`), и он законен: плагину с одним маршрутом незачем
 * придумывать ему имя.
 */
function normalizeRoutePath(declared: unknown): string | undefined {
  if (typeof declared !== "string") {
    return undefined;
  }

  const segments = declared.split("/").filter((segment) => segment.length > 0);

  if (!segments.every((segment) => routeSegmentPattern.test(segment))) {
    return undefined;
  }

  const parameters = segments
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));

  // Два одинаковых имени параметра означали бы, что одно значение молча съедает другое.
  return new Set(parameters).size === parameters.length ? segments.join("/") : undefined;
}

function selectionPart(
  selection: unknown,
  part: "include" | "exclude",
  absent: string[],
): string[] | undefined {
  if (selection === undefined) {
    return absent;
  }
  if (typeof selection !== "object" || selection === null) {
    return undefined;
  }
  const value = (selection as Record<string, unknown>)[part];
  if (value === undefined) {
    return part === "exclude" ? [] : undefined;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}
