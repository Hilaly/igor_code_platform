import { z } from "@sovereign/sdk";

const missionStepSchema = z.strictObject({
  step: z.string().trim().min(1, "step must not be empty"),
  status: z.enum(["pending", "in_progress", "completed"]),
});

export const missionInputSchema = z.strictObject({
  mission: z.string().trim().min(1, "mission must not be empty"),
  explanation: z.string().trim().min(1, "explanation must not be empty").optional(),
  plan: z.array(missionStepSchema).min(1, "plan must contain at least one step"),
});

export type MissionStep = z.infer<typeof missionStepSchema>;
export type MissionInput = z.infer<typeof missionInputSchema>;

export const missionSnapshotSchema = z.strictObject({
  mission: z.string().min(1),
  explanation: z.string().min(1).optional(),
  plan: z.array(missionStepSchema).min(1),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export type MissionSnapshot = z.infer<typeof missionSnapshotSchema>;

export function validateMissionInput(value: unknown): MissionInput {
  const parsed = missionInputSchema.parse(value);
  const activeSteps = parsed.plan.filter((step) => step.status === "in_progress").length;

  if (activeSteps > 1) {
    throw new Error("mission plan may contain at most one in_progress step");
  }

  return parsed;
}

export function parseMissionSnapshot(value: unknown): MissionSnapshot {
  return missionSnapshotSchema.parse(value);
}
