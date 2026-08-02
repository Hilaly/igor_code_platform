import { contribute, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await contribute.agent({ id: "agent", instructions: "Programmatic agent." });
  await contribute.custom({ id: "board", title: "Board" });
};
