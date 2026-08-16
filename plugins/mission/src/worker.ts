import { contribute, log, type PluginModule } from "@sovereign/sdk";

import { contributeRoutes } from "./routes.ts";
import { contributeTools, changed } from "./tools.ts";

export const activate: PluginModule["activate"] = async () => {
  await contribute.event(changed);
  await contributeTools();
  await contributeRoutes();
  await contribute.component({
    id: "panel",
    title: "Mission",
    placeId: "core.panel.tabs",
    export: "MissionPanel",
  });
  await log.info("the mission plugin is active");
};
