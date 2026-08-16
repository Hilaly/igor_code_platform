import {
  corePlace,
  orderPlaceContributions,
  resolvePlaceDeclaration,
  resolvePlaceProvider,
  type ComponentContributionRegistration,
  type ContributionRegistration,
  type PlaceContributionRegistration,
  type PluginStatus,
} from "@sovereign/protocol";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import { CommandButton } from "./commands.tsx";
import { useDiagnosticVoice } from "./diagnostics.ts";
import { boundaryKey, InstanceBoundary } from "./instance-boundary.tsx";
import {
  BrowserRuntimeContext,
  type BrowserRuntime,
  type BrowserEventBridge,
  type PlaceContext,
  type PlaceProps,
} from "./runtime-context.tsx";

export { useHostCommandCatalog, type HostCommandCatalogEntry } from "./commands.tsx";
export { pluginCatalogs } from "./i18n.ts";
export { isSettingsSection } from "./navigation.ts";
export { normalizePagePath } from "./page-path.ts";
export { HostPluginPage, type HostPageNavigation, type HostPluginPageProps } from "./page.tsx";

export type LoadedPluginModule = Record<string, unknown>;

export type PluginModuleLoad =
  | { kind: "loading" }
  | { kind: "loaded"; module: LoadedPluginModule }
  | { kind: "failed"; reason: string };

export type PluginModuleCache = {
  load(status: PluginStatus): PluginModuleLoad;
  peek(status: PluginStatus): PluginModuleLoad | undefined;
  version(): number;
  retain(statuses: readonly PluginStatus[]): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

export type BrowserRuntimeProviderProps = {
  contributions: readonly ContributionRegistration[];
  plugins: readonly PluginStatus[];
  onDiagnostic(text: string): void;
  events: BrowserEventBridge;
  /**
   * Язык окна. Обязателен, а не с умолчанием: язык знает хост, и молчаливое умолчание превратило бы
   * забытый проп в английские панели у человека, выбравшего другой язык.
   */
  locale: string;
  createCache(): PluginModuleCache;
  cache?: PluginModuleCache;
  children: ReactNode;
};

export type HostPlaceProps = PlaceProps & { builtIn: ReactNode };

export type BrowserExportReference = {
  pluginKey: string;
  contributionId: string;
  exportName: string;
};

type PlaceInstanceProps = {
  reference: BrowserExportReference;
  context: PlaceContext;
  fallback: ReactNode;
  /** Как называть вклад в диагностике: страница — не компонент, и человек читает про то, что открыл. */
  subject?: "component" | "page";
};

type PlaceComponent = ComponentType<{ context: PlaceContext }>;

export function BrowserRuntimeProvider({
  contributions,
  plugins,
  onDiagnostic,
  events,
  locale,
  createCache,
  cache,
  children,
}: BrowserRuntimeProviderProps): ReactNode {
  const owned = useMemo(() => cache ?? createCache(), [cache, createCache]);
  const cacheLifecycle = useRef<{ cache: PluginModuleCache; generation: number } | undefined>(
    undefined,
  );
  const nextCacheGeneration = useRef(0);

  useEffect(() => {
    owned.retain(plugins);
  }, [owned, plugins]);

  useEffect(() => {
    const generation = ++nextCacheGeneration.current;
    const previous = cacheLifecycle.current;

    if (previous !== undefined && previous.cache !== owned) {
      previous.cache.dispose();
    }
    cacheLifecycle.current = { cache: owned, generation };

    return () => {
      // StrictMode replays setup and cleanup on the same cache. Deferring cleanup lets the second
      // setup replace the generation, while a real unmount still disposes the current cache.
      queueMicrotask(() => {
        const current = cacheLifecycle.current;

        if (current?.cache !== owned || current.generation !== generation) {
          return;
        }

        cacheLifecycle.current = undefined;
        owned.dispose();
      });
    };
  }, [owned]);

  const runtime = useMemo<BrowserRuntime>(
    () => ({ contributions, plugins, cache: owned, onDiagnostic, events, locale }),
    [contributions, plugins, owned, onDiagnostic, events, locale],
  );

  return <BrowserRuntimeContext value={runtime}>{children}</BrowserRuntimeContext>;
}

export function HostPlace({ id, context, builtIn }: HostPlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);

  return runtime === undefined ? (
    builtIn
  ) : (
    <SinglePlace id={id} context={context} builtIn={builtIn} runtime={runtime} replaceable />
  );
}

export function HostPlaceCollection({ id, context }: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);
  const declaration = corePlace(id);

  return runtime === undefined ||
    (declaration?.cardinality !== "collection" && declaration?.cardinality !== "action") ? null : (
    <CollectionPlace
      id={id}
      context={context}
      runtime={runtime}
      cardinality={declaration.cardinality}
    />
  );
}

export function PluginPlace({ id, context }: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);

  if (runtime === undefined) {
    return null;
  }

  const declaration = resolvePlaceDeclaration(id, runtime.contributions, context);

  if (declaration?.cardinality !== "single") {
    return null;
  }

  const builtIn = ownerBuiltIn(declaration, context);

  return (
    <SinglePlace
      id={id}
      context={context}
      builtIn={builtIn}
      runtime={runtime}
      replaceable={declaration.replaceable}
    />
  );
}

export function PluginPlaceCollection({ id, context }: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);

  if (runtime === undefined) {
    return null;
  }

  const declaration = resolvePlaceDeclaration(id, runtime.contributions, context);

  if (declaration?.cardinality !== "collection" && declaration?.cardinality !== "action") {
    return null;
  }

  return (
    <CollectionPlace
      id={id}
      context={context}
      runtime={runtime}
      cardinality={declaration.cardinality}
    />
  );
}

function ownerBuiltIn(
  declaration: PlaceContributionRegistration,
  context: PlaceContext,
): ReactNode {
  if (declaration.ownership !== "plugin" || declaration.builtIn === undefined) {
    return null;
  }

  return (
    <PlaceInstance
      reference={{
        pluginKey: declaration.pluginKey,
        contributionId: declaration.id,
        exportName: declaration.builtIn,
      }}
      context={context}
      fallback={null}
    />
  );
}

function SinglePlace({
  id,
  context,
  builtIn,
  runtime,
  replaceable,
}: PlaceProps & {
  builtIn: ReactNode;
  runtime: BrowserRuntime;
  replaceable: boolean;
}): ReactNode {
  const say = useDiagnosticVoice(runtime);
  const resolution = replaceable
    ? resolvePlaceProvider(id, runtime.contributions, context)
    : { kind: "built-in" as const };
  const dispute =
    resolution.kind === "disputed"
      ? `the place ${id} is claimed by ${resolution.contenders
          .map((contender) => contender.id)
          .join(", ")} of equal rank, so none of them takes it`
      : undefined;

  useEffect(() => {
    if (dispute !== undefined) {
      say(dispute);
    }
  }, [dispute, say]);

  if (!replaceable || resolution.kind !== "plugin") {
    return builtIn;
  }

  const reference = referenceOf(resolution.contribution);

  if (reference === undefined) {
    return builtIn;
  }

  return <PlaceInstance reference={reference} context={context} fallback={builtIn} />;
}

function CollectionPlace({
  id,
  context,
  runtime,
  cardinality,
}: PlaceProps & {
  runtime: BrowserRuntime;
  cardinality: "collection" | "action";
}): ReactNode {
  const registrations = orderPlaceContributions(id, runtime.contributions, context).filter(
    (registration) => cardinality === "action" || registration.kind !== "command",
  );

  return (
    <>
      {registrations.map((registration) => {
        // Команда содержимого не даёт: за неё в полосе стоит кнопка с заголовком из снимка.
        if (registration.kind === "command") {
          return (
            <CommandButton
              key={`${registration.kind}:${registration.id}`}
              registration={registration}
              context={context}
            />
          );
        }

        const reference = referenceOf(registration);

        return reference === undefined ? null : (
          <PlaceInstance
            key={`${registration.kind}:${registration.id}`}
            reference={reference}
            context={context}
            fallback={null}
          />
        );
      })}
    </>
  );
}

function referenceOf(
  registration: ComponentContributionRegistration,
): BrowserExportReference | undefined {
  if (registration.ownership !== "plugin") {
    return undefined;
  }

  return {
    pluginKey: registration.pluginKey,
    contributionId: registration.id,
    exportName: registration.export,
  };
}

export function PlaceInstance({
  reference,
  context,
  fallback,
  subject = "component",
}: PlaceInstanceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);
  const say = useDiagnosticVoice(runtime);
  const status = runtime?.plugins.find((plugin) => plugin.key === reference.pluginKey);
  const load = useSyncExternalStore(runtime?.cache.subscribe ?? emptySubscribe, () =>
    runtime === undefined || status === undefined ? undefined : runtime.cache.load(status),
  );
  const exported = load?.kind === "loaded" ? load.module[reference.exportName] : undefined;
  const complaint =
    runtime === undefined
      ? undefined
      : status === undefined
        ? `the ${subject} ${reference.contributionId} names the plugin ${reference.pluginKey}, which is not in the snapshot`
        : load?.kind === "failed"
          ? `the ${subject} ${reference.contributionId} could not be loaded: ${load.reason}`
          : load?.kind === "loaded" && typeof exported !== "function"
            ? `the plugin ${status.key} exports no ${reference.exportName} for the ${subject} ${reference.contributionId}`
            : undefined;

  useEffect(() => {
    if (complaint !== undefined) {
      say(complaint);
    }
  }, [complaint, say]);

  if (typeof exported !== "function") {
    return fallback;
  }

  const Instance = exported as PlaceComponent;

  return (
    <InstanceBoundary
      key={boundaryKey(
        reference.pluginKey,
        reference.contributionId,
        reference.exportName,
        status?.browser?.revision,
      )}
      fallback={fallback}
      onFailure={(reason) => {
        say(`the ${subject} ${reference.contributionId} failed while rendering: ${reason}`);
      }}
    >
      <Instance context={context} />
    </InstanceBoundary>
  );
}

function emptySubscribe(): () => void {
  return () => {};
}
