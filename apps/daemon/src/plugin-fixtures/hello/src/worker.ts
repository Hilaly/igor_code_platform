import { contribute, log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await contribute.custom({ id: "board", title: "Board" });
  await log.info("hello is up");
};

export const deactivate: PluginModule["deactivate"] = async () => {
  await log.info("hello is going down");
};
