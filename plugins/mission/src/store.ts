import { storage } from "@sovereign/sdk";

import {
  parseMissionSnapshot,
  validateMissionInput,
  type MissionInput,
  type MissionSnapshot,
} from "./model.ts";

const keyFor = (sessionId: string) => `mission.${sessionId}`;
const writes = new Map<string, Promise<unknown>>();

export async function readMission(sessionId: string): Promise<MissionSnapshot | undefined> {
  const value = await storage.get(keyFor(sessionId));

  return value === undefined ? undefined : parseMissionSnapshot(value);
}

export async function writeMission(sessionId: string, value: unknown): Promise<MissionSnapshot> {
  const previous = writes.get(sessionId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const input: MissionInput = validateMissionInput(value);
      const stored = await readMission(sessionId);
      const snapshot: MissionSnapshot = {
        ...input,
        revision: (stored?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      await storage.set(keyFor(sessionId), snapshot);
      return snapshot;
    });
  writes.set(sessionId, current);
  try {
    return await current;
  } finally {
    if (writes.get(sessionId) === current) writes.delete(sessionId);
  }
}
