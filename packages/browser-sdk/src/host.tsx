import type { ContributionRegistration, PluginStatus } from "@sovereign/protocol";
import { useEffect, useMemo, useRef, type ComponentType, type ReactNode } from "react";

import type { PlaceProps } from "./index.tsx";
import { BrowserRuntimeContext, type BrowserRuntime } from "./runtime-context.tsx";

export type LoadedPluginModule = Record<string, unknown>;

export type PluginModuleLoad =
  | { kind: "loading" }
  | { kind: "loaded"; module: LoadedPluginModule }
  | { kind: "failed"; reason: string };

export type PluginModuleCache = {
  moduleOf(status: PluginStatus): PluginModuleLoad;
  retain(statuses: readonly PluginStatus[]): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

export type BrowserRuntimeProviderProps = {
  contributions: readonly ContributionRegistration[];
  plugins: readonly PluginStatus[];
  onDiagnostic(text: string): void;
  createCache(): PluginModuleCache;
  cache?: PluginModuleCache;
  children: ReactNode;
};

export type HostPlaceProps = PlaceProps & { builtIn: ReactNode };

const EmptyPlace: ComponentType<PlaceProps> = () => null;
const EmptyPlaceCollection: ComponentType<PlaceProps> = () => null;

export function BrowserRuntimeProvider({
  contributions,
  plugins,
  onDiagnostic,
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
      // React StrictMode replays setup and cleanup on the same cache. Deferring cleanup lets the
      // second setup replace the generation, while a real unmount still disposes the current cache.
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
    () => ({
      contributions,
      plugins,
      cache: owned,
      onDiagnostic,
      Place: EmptyPlace,
      PlaceCollection: EmptyPlaceCollection,
    }),
    [contributions, plugins, owned, onDiagnostic],
  );

  return <BrowserRuntimeContext value={runtime}>{children}</BrowserRuntimeContext>;
}

export function HostPlace({ builtIn }: HostPlaceProps): ReactNode {
  return builtIn;
}

export function HostPlaceCollection(props: PlaceProps): ReactNode {
  void props;
  return null;
}
