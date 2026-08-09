import {
  BrowserRuntimeProvider as SdkBrowserRuntimeProvider,
  HostPlace,
  HostPlaceCollection,
  type BrowserRuntimeProviderProps as SdkBrowserRuntimeProviderProps,
} from "@sovereign/browser-sdk/host";
import type { ReactNode } from "react";

import { createPluginModuleCache } from "./module-cache.ts";

export type BrowserRuntimeProviderProps = Omit<SdkBrowserRuntimeProviderProps, "createCache">;

export function BrowserRuntimeProvider(props: BrowserRuntimeProviderProps): ReactNode {
  return <SdkBrowserRuntimeProvider {...props} createCache={createPluginModuleCache} />;
}

export { HostPlace, HostPlaceCollection };
