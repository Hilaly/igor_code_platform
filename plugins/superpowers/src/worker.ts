import { log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await log.info("the superpowers plugin is active");
};

export const deactivate: PluginModule["deactivate"] = async () => {};
