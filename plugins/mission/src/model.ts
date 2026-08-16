import { z } from "@sovereign/sdk";

/**
 * Форма миссии и её проверки. Схема уезжает модели вместе с объявлением инструмента
 * (`z.toJSONSchema`), поэтому `.describe()` здесь — не комментарий для читателя исходника, а текст,
 * который модель видит в описании аргументов.
 */

/**
 * Пять состояний шага. `blocked` и `skipped` добавлены потому, что без них агент, упершийся в
 * препятствие, обязан был соврать `completed` или навсегда оставить `in_progress`: обе записи
 * означают «шаг не сделан», но читаются как разные вещи, и ни одна не называет причину.
 */
const stepStatuses = ["pending", "in_progress", "completed", "blocked", "skipped"] as const;

/** Состояния, у которых причина обязательна: и то и другое — отход от плана, и он объясняется. */
const statusesNeedingReason: readonly string[] = ["blocked", "skipped"];

const missionStepSchema = z.strictObject({
  step: z.string().trim().min(1, "step must not be empty").describe("What this step does."),
  status: z.enum(stepStatuses).describe("The state of this step."),
  reason: z
    .string()
    .trim()
    .min(1, "reason must not be empty")
    .optional()
    .describe(
      "Why the step is blocked or skipped. Required for those two statuses, rejected for the rest.",
    ),
});

/**
 * Исход миссии. Отсутствие исхода означает «ещё в работе», и третьего значения вроде `abandoned` в
 * перечислении нет намеренно: брошенную миссию некому пометить — тот, кто её бросил, до записи
 * исхода не доходит. Брошенность видна как миссия без исхода в закрытой сессии, и выдавать её за
 * объявленное состояние значило бы обещать запись, которой не бывает.
 */
const missionOutcomeSchema = z.strictObject({
  kind: z.enum(["succeeded", "failed"]).describe("How the mission ended."),
  summary: z
    .string()
    .trim()
    .min(1, "outcome summary must not be empty")
    .describe("The result if it succeeded, or what stopped it if it failed."),
});

export const missionInputSchema = z.strictObject({
  mission: z
    .string()
    .trim()
    .min(1, "mission must not be empty")
    .describe("The goal of the current work in one sentence."),
  explanation: z
    .string()
    .trim()
    .min(1, "explanation must not be empty")
    .optional()
    .describe("Where the work stands right now: what just happened and what comes next."),
  plan: z
    .array(missionStepSchema)
    .min(1, "plan must contain at least one step")
    .describe("The ordered steps of the mission. At most one may be in_progress."),
  outcome: missionOutcomeSchema
    .optional()
    .describe("Set this only when the mission is over. Leave it out while work continues."),
});

export type MissionStep = z.infer<typeof missionStepSchema>;
export type MissionOutcome = z.infer<typeof missionOutcomeSchema>;
export type MissionInput = z.infer<typeof missionInputSchema>;

export const missionSnapshotSchema = missionInputSchema.extend({
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export type MissionSnapshot = z.infer<typeof missionSnapshotSchema>;

/**
 * Проверки, которых нет в схеме: они связывают поля между собой. Текст ошибки читает модель, поэтому
 * он называет и нарушенное правило, и то, что с ним делать.
 */
export function validateMissionInput(value: unknown): MissionInput {
  const parsed = missionInputSchema.parse(value);
  const active = parsed.plan.filter((step) => step.status === "in_progress");

  if (active.length > 1) {
    throw new Error(
      `mission plan may contain at most one in_progress step, got ${active.length}: work on one step at a time`,
    );
  }

  for (const step of parsed.plan) {
    const needsReason = statusesNeedingReason.includes(step.status);

    if (needsReason && step.reason === undefined) {
      throw new Error(`the ${step.status} step "${step.step}" must carry a reason`);
    }

    if (!needsReason && step.reason !== undefined) {
      throw new Error(
        `only blocked and skipped steps carry a reason, but the ${step.status} step "${step.step}" has one`,
      );
    }
  }

  if (parsed.outcome !== undefined) {
    // Исход и незакрытый шаг вместе означают, что закончилась не миссия, а внимание к ней.
    if (active.length > 0) {
      throw new Error(
        "a mission with an outcome has no in_progress step: close the step before recording the outcome",
      );
    }

    const unfinished = parsed.plan.filter(
      (step) => step.status !== "completed" && step.status !== "skipped",
    );

    if (parsed.outcome.kind === "succeeded" && unfinished.length > 0) {
      throw new Error(
        `a succeeded mission has every step completed or skipped, but ${unfinished.length} of ${parsed.plan.length} are not: record the outcome as failed, or finish the steps`,
      );
    }
  }

  return parsed;
}

export function parseMissionSnapshot(value: unknown): MissionSnapshot {
  return missionSnapshotSchema.parse(value);
}
