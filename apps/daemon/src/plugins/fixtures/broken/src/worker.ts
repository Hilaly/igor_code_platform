import type { PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = () => {
  throw new Error("this plugin is broken on purpose");
};
