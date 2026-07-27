import { log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await log.info("hanging is up");
};

/** Обещание, которое никогда не разрешится: супервизор не имеет права ждать его вечно. */
export const deactivate: PluginModule["deactivate"] = () => new Promise<void>(() => {});
