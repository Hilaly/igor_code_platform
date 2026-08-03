import { contribute, log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await contribute.custom({ id: "board", title: "Board" });
  await log.info("file-resources is up");
};
