import { contribute, defineEvent, z, type PluginToolInvocation } from "@sovereign/sdk";

import { missionInputSchema } from "./model.ts";
import { writeMission } from "./store.ts";

export const changed = defineEvent(
  "changed",
  z.strictObject({
    sessionId: z.string().min(1),
    revision: z.number().int().positive(),
  }),
);

export async function contributeTools(): Promise<void> {
  await contribute.tool({
    id: "mission-update",
    title: "Update the current mission",
    description:
      "Set the mission and its ordered progress plan for the current session. Replace the complete snapshot in one call.",
    parameters: missionInputSchema,
    invoke: async (input, invocation: PluginToolInvocation) => {
      const snapshot = await writeMission(invocation.sessionId, input);
      await changed.publish({ sessionId: invocation.sessionId, revision: snapshot.revision });

      return `Mission updated (revision ${snapshot.revision}).`;
    },
  });
}
