import type { ReactNode } from "react";

import { PluginPlace, PluginPlaceCollection } from "./host.tsx";
import type { PlaceContext, PlaceProps } from "./runtime-context.tsx";
import { PluginPlaceTabs } from "./tabs.tsx";

export type { PlaceContext, PlaceProps };

export function Place(props: PlaceProps): ReactNode {
  return <PluginPlace {...props} />;
}

export function PlaceCollection(props: PlaceProps): ReactNode {
  return <PluginPlaceCollection {...props} />;
}

export function PlaceTabs(props: PlaceProps): ReactNode {
  return <PluginPlaceTabs {...props} />;
}
