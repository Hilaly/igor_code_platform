import type { BusStreamEvent, ContributionRegistration, PluginStatus } from "@sovereign/protocol";
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

export type BrowserEvent = BusStreamEvent;
export type BrowserEventListener = (event: BrowserEvent) => void;
export type BrowserEventBridge = {
  subscribe(listener: BrowserEventListener): () => void;
};

export type BrowserRuntime = {
  contributions: readonly ContributionRegistration[];
  plugins: readonly PluginStatus[];
  cache: PluginModuleCache;
  onDiagnostic(text: string): void;
  events: BrowserEventBridge;
};

export const BrowserRuntimeContext = createContext<BrowserRuntime | undefined>(undefined);
