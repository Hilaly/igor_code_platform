import { contribute, log, type PluginModule } from "@sovereign/sdk";

import { contributeRoutes } from "./routes.ts";
import { contributeTools, changed } from "./tools.ts";

export const activate: PluginModule["activate"] = async () => {
  await contribute.event(changed);
  await contributeTools();
  await contributeRoutes();
  await log.info("the mission plugin is active");
};
