import { contribute, defineEvent, log, z, type PluginModule } from "@sovereign/sdk";

export const taskCreated = defineEvent("task.created", z.object({ id: z.string() }));

let ticking: ReturnType<typeof setInterval> | undefined;

export const activate: PluginModule["activate"] = async () => {
  await contribute.event(taskCreated);

  // Публикация повторяется, потому что объявление вступает в силу только после возврата из
  // activate: вклады применяются одним снимком (ADR-0024), и первая попытка может быть до этого.
  ticking = setInterval(() => {
    void taskCreated.publish({ id: "42" });
  }, 20);

  await log.info("publisher is up");
};

export const deactivate: PluginModule["deactivate"] = async () => {
  clearInterval(ticking);
};
