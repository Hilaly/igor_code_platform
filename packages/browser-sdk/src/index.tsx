import { useContext, type ReactNode } from "react";

import {
  useCommandCatalog,
  useCommands,
  type Command,
  type CommandInvoker,
  type CommandOutcome,
} from "./commands.tsx";
import { PluginPlace, PluginPlaceCollection } from "./host.tsx";
import { settingsSections, type CoreDestination, type SettingsSection } from "./navigation.ts";
import { usePageNavigation, type PageNavigateOptions, type PageNavigation } from "./page.tsx";
import type { PlaceContext, PlaceProps } from "./runtime-context.tsx";
import { PluginPlaceTabs } from "./tabs.tsx";
import { BrowserRuntimeContext } from "./runtime-context.tsx";
export type {
  BrowserEvent,
  BrowserEventBridge,
  BrowserEventListener,
  BrowserRecoveryListener,
} from "./runtime-context.tsx";

export type {
  Command,
  CommandInvoker,
  CommandOutcome,
  CoreDestination,
  PageNavigateOptions,
  PageNavigation,
  PlaceContext,
  PlaceProps,
  SettingsSection,
};

export { settingsSections, useCommandCatalog, useCommands, usePageNavigation };

export function useSovereignEvents() {
  const runtime = useContext(BrowserRuntimeContext);

  if (runtime === undefined) {
    throw new Error("useSovereignEvents must be used inside BrowserRuntimeProvider");
  }

  return runtime.events;
}

export function Place(props: PlaceProps): ReactNode {
  return <PluginPlace {...props} />;
}

export function PlaceCollection(props: PlaceProps): ReactNode {
  return <PluginPlaceCollection {...props} />;
}

export function PlaceTabs(props: PlaceProps): ReactNode {
  return <PluginPlaceTabs {...props} />;
}
