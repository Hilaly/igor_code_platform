import type { ContributionRegistration, PluginStatus } from "@sovereign/protocol";
import { createContext } from "react";

import type { PluginModuleCache } from "./host.tsx";

export type PlaceContext = {
  project?: string;
  subject?: Readonly<Record<string, string>>;
};

export type PlaceProps = {
  id: string;
  context: PlaceContext;
};

export type BrowserRuntime = {
  contributions: readonly ContributionRegistration[];
  plugins: readonly PluginStatus[];
  cache: PluginModuleCache;
  onDiagnostic(text: string): void;
};

export const BrowserRuntimeContext = createContext<BrowserRuntime | undefined>(undefined);
