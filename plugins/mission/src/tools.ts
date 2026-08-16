import { contribute, defineEvent, z, type PluginToolInvocation } from "@sovereign/sdk";

import { missionInputSchema } from "./model.ts";
import { renderSnapshot } from "./render.ts";
import { readMission, writeMission } from "./store.ts";

export const changed = defineEvent(
  "changed",
  z.strictObject({
    sessionId: z.string().min(1),
    revision: z.number().int().positive(),
  }),
);

/**
 * Описание — часть контракта, а не подпись к нему: поведение модели с плановым инструментом задаётся
 * им сильнее, чем схемой. Поэтому здесь сказано не только что инструмент делает, но и когда его
 * звать, — молчание об этом читается как «по желанию», и план перестаёт обновляться первым же, за
 * что модель зацепилась.
 */
const updateDescription = [
  "Set the mission and its ordered plan for the current session, and keep both true as the work moves.",
  "",
  "Call it before starting non-trivial work, to record the goal and the steps; again whenever a step starts, finishes, turns out to be blocked, or is dropped; and once more at the end to record the outcome. A plan that stops being updated is worse than no plan: it reports progress that never happened.",
  "",
  "One call replaces the whole snapshot, so send every step each time, not only the one that changed. At most one step may be in_progress, and it is marked before the work on it starts, not after. A step that cannot be done is blocked or skipped with a reason — never completed. Record the outcome only once the mission is over.",
  "",
  "The call returns the stored snapshot. That text, not your memory of it, is what the user sees in the mission panel.",
].join("\n");

const readDescription = [
  "Read the mission snapshot stored for the current session.",
  "",
  "Call it when the current mission and plan are no longer in front of you — after a long stretch of work, or when picking a session back up — before continuing or updating them. The mission lives outside the conversation and outlives it, so the stored snapshot is the source of truth and your recollection is not.",
  "",
  "It returns the same text mission-update returns.",
].join("\n");

export async function contributeTools(): Promise<void> {
  await contribute.tool({
    id: "mission-update",
    title: "Update the current mission",
    description: updateDescription,
    parameters: missionInputSchema,
    invoke: async (input, invocation: PluginToolInvocation) => {
      try {
        const snapshot = await writeMission(invocation.sessionId, input);
        await changed.publish({ sessionId: invocation.sessionId, revision: snapshot.revision });

        return renderSnapshot(snapshot);
      } catch (cause) {
        return {
          content: `Mission update failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          isError: true,
        };
      }
    },
  });

  await contribute.tool({
    id: "mission-read",
    title: "Read the current mission",
    description: readDescription,
    parameters: z.strictObject({}),
    invoke: async (_input, invocation: PluginToolInvocation) => {
      try {
        const snapshot = await readMission(invocation.sessionId);

        return snapshot === undefined
          ? "There is no mission for this session yet. Call mission-update to record one."
          : renderSnapshot(snapshot);
      } catch (cause) {
        return {
          content: `Mission read failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          isError: true,
        };
      }
    },
  });
}
