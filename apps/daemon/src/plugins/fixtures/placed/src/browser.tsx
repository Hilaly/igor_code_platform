import { Place, PlaceCollection, type PlaceContext } from "@sovereign/browser-sdk";
import { Badge, Heading, Text } from "@sovereign/ui-kit";
import { useState } from "react";

import styles from "./browser.module.css";

export function PluginsPanel({ context }: { context: PlaceContext }) {
  const [count, setCount] = useState(0);

  return (
    <div className={styles.panel}>
      <Heading level={2}>Plugins, by the placed plugin</Heading>
      <Text>view: {context.subject?.["view"] ?? "—"}</Text>
      <button onClick={() => setCount(count + 1)}>clicked {count} times</button>
      <Place id="placed.board" context={context} />
      <PlaceCollection id="placed.board-actions" context={context} />
    </div>
  );
}

export function SidebarSection() {
  return (
    <div className={styles.panel}>
      <Badge tone="accent">placed section</Badge>
    </div>
  );
}

export function HeaderAction() {
  return <Badge tone="success">placed action</Badge>;
}

export function Boom(): never {
  throw new Error("the placed plugin cannot render this");
}

export function Board({ context }: { context: PlaceContext }) {
  return <Text>the built-in board for {context.project ?? "the window"}</Text>;
}
