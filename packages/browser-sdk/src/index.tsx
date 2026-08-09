import type { ReactNode } from "react";

import { PluginPlace, PluginPlaceCollection } from "./host.tsx";
import type { PlaceContext, PlaceProps } from "./runtime-context.tsx";

export type { PlaceContext, PlaceProps };

export function Place(props: PlaceProps): ReactNode {
  return <PluginPlace {...props} />;
}

export function PlaceCollection(props: PlaceProps): ReactNode {
  return <PluginPlaceCollection {...props} />;
}
