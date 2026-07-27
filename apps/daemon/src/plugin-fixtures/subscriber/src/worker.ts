import { events, log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  // Имя чужое и полное: подписка не требует, чтобы публикатор был поднят (ADR-0072).
  await events.subscribe("publisher.task.created", async (payload, origin) => {
    await log.info("subscriber got the event", { payload, from: origin?.id });
  });

  await log.info("subscriber is up");
};
