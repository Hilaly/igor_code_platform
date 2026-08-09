import { useContext, type ReactNode } from "react";

import { BrowserRuntimeContext } from "./runtime-context.tsx";

export type PlaceContext = {
  project?: string;
  subject?: Readonly<Record<string, string>>;
};

export type PlaceProps = {
  id: string;
  context: PlaceContext;
};

export function Place(props: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);

  return runtime === undefined ? null : <runtime.Place {...props} />;
}

export function PlaceCollection(props: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);

  return runtime === undefined ? null : <runtime.PlaceCollection {...props} />;
}
