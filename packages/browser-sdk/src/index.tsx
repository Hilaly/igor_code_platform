import type { ReactNode } from "react";

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

export function Place(props: PlaceProps): ReactNode {
  return <PluginPlace {...props} />;
}

export function PlaceCollection(props: PlaceProps): ReactNode {
  return <PluginPlaceCollection {...props} />;
}

export function PlaceTabs(props: PlaceProps): ReactNode {
  return <PluginPlaceTabs {...props} />;
}
