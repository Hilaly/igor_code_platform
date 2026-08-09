import { contribute, log } from "@sovereign/sdk";

export const activate = async (): Promise<void> => {
  await contribute.component({
    id: "panel",
    title: "A component of a plugin that has no browser part",
    placeId: "core.settings.projects",
    export: "Panel",
  });

  await log.info("the browserless plugin is active");
};
