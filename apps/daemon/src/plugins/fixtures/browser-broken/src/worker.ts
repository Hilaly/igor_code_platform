import { log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await log.info("browser-broken is up");
};
