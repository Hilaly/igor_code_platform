import { storage } from "@sovereign/sdk";

import {
  parseMissionSnapshot,
  validateMissionInput,
  type MissionInput,
  type MissionSnapshot,
} from "./model.ts";

const keyFor = (sessionId: string) => `mission.${sessionId}`;

export async function readMission(sessionId: string): Promise<MissionSnapshot | undefined> {
  const value = await storage.get(keyFor(sessionId));

  return value === undefined ? undefined : parseMissionSnapshot(value);
}

export async function writeMission(
  sessionId: string,
  value: unknown,
): Promise<MissionSnapshot> {
  const input: MissionInput = validateMissionInput(value);
  const previous = await readMission(sessionId);
  const snapshot: MissionSnapshot = {
    ...input,
    revision: (previous?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };

  await storage.set(keyFor(sessionId), snapshot);

  return snapshot;
}
