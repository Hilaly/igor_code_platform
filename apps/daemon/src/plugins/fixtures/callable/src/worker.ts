import { contribute, log, z, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await contribute.tool({
    id: "echo",
    description: "повторяет сказанное",
    parameters: z.object({ text: z.string() }),
    invoke: ({ text }) => `эхо: ${text}`,
  });

  await contribute.tool({
    id: "broken",
    description: "всегда падает",
    parameters: z.object({}),
    invoke: () => {
      throw new Error("the tool is broken");
    },
  });

  await contribute.hook({
    id: "watch",
    event: "turn_finished",
    handler: async (payload) => {
      await log.info("the turn finished", { session: payload.sessionId });
    },
  });

  await contribute.hook({
    id: "guard",
    event: "before_session_start",
    criticality: "critical",
    handler: ({ folder }) =>
      folder === "/forbidden" ? { refuse: "эта папка закрыта" } : undefined,
  });

  await contribute.hook({
    id: "throws",
    event: "before_session_start",
    handler: () => {
      throw new Error("the handler is broken");
    },
  });

  /** Обработчик, который не отвечает никогда: ждать его — работа ядра, а не воркера. */
  await contribute.hook({
    id: "hangs",
    event: "before_session_start",
    handler: () => new Promise<undefined>(() => {}),
  });

  await log.info("callable is up");
};
