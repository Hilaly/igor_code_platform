import type { ReactNode } from "react";

import {
  useCommands,
  type Command,
  type CommandInvoker,
  type CommandOutcome,
} from "./commands.tsx";
import { PluginPlace, PluginPlaceCollection } from "./host.tsx";
import type { PlaceContext, PlaceProps } from "./runtime-context.tsx";
import { PluginPlaceTabs } from "./tabs.tsx";

export type { Command, CommandInvoker, CommandOutcome, PlaceContext, PlaceProps };

export { useCommands };

export function Place(props: PlaceProps): ReactNode {
  return <PluginPlace {...props} />;
}

export function PlaceCollection(props: PlaceProps): ReactNode {
  return <PluginPlaceCollection {...props} />;
}

export function PlaceTabs(props: PlaceProps): ReactNode {
  return <PluginPlaceTabs {...props} />;
}
