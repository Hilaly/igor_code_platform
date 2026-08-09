import type { ContributionRegistration, PluginStatus } from "@sovereign/protocol";
import { createContext, type ComponentType } from "react";

import type { PluginModuleCache } from "./host.tsx";
import type { PlaceProps } from "./index.tsx";

export type BrowserRuntime = {
  contributions: readonly ContributionRegistration[];
  plugins: readonly PluginStatus[];
  cache: PluginModuleCache;
  onDiagnostic(text: string): void;
  Place: ComponentType<PlaceProps>;
  PlaceCollection: ComponentType<PlaceProps>;
};

export const BrowserRuntimeContext = createContext<BrowserRuntime | undefined>(undefined);
