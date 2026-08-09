import { contribute, log } from "@sovereign/sdk";

export const activate = async (): Promise<void> => {
  await contribute.component({
    id: "plugins",
    title: "Plugins view of the rival plugin",
    placeId: "core.settings.plugins",
    export: "PluginsPanel",
  });

  await contribute.component({
    id: "board",
    title: "Replacement board of the rival plugin",
    placeId: "placed.board",
    export: "Board",
  });

  await contribute.component({
    id: "board-action",
    title: "Board action of the rival plugin",
    placeId: "placed.board-actions",
    export: "BoardAction",
  });

  await log.info("the rival plugin is active");
};
