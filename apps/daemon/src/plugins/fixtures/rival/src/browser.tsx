import type { PlaceContext } from "@sovereign/browser-sdk";
import { Badge, Heading, Text } from "@sovereign/ui-kit";

export function PluginsPanel() {
  return <Heading level={2}>Plugins, by the rival plugin</Heading>;
}

export function Board({ context }: { context: PlaceContext }) {
  return <Text>the rival replacement board for {context.project ?? "the window"}</Text>;
}

export function BoardAction() {
  return <Badge tone="accent">rival board action</Badge>;
}
