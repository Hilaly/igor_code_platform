import { contribute, log } from "@sovereign/sdk";

export const activate = async (): Promise<void> => {
  await contribute.place({
    id: "board",
    title: "Board of the placed plugin",
    cardinality: "single",
    replaceable: true,
    builtIn: "Board",
  });

  await contribute.place({
    id: "board-actions",
    title: "Actions of the placed board",
    cardinality: "action",
    replaceable: false,
  });

  await contribute.component({
    id: "plugins",
    title: "Plugins view of the placed plugin",
    placeId: "core.settings.plugins",
    export: "PluginsPanel",
  });

  await contribute.component({
    id: "section",
    title: "Sidebar section of the placed plugin",
    placeId: "core.sidebar.sections",
    export: "SidebarSection",
    order: 1,
  });

  await contribute.component({
    id: "action",
    title: "Header action of the placed plugin",
    placeId: "core.view.header.actions",
    export: "HeaderAction",
  });

  await contribute.component({
    id: "boom",
    title: "A component that throws while rendering",
    placeId: "core.sidebar.sections",
    export: "Boom",
    order: 2,
  });

  await log.info("the placed plugin is active");
};
