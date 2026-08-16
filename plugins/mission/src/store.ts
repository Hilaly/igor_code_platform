import { storage } from "@sovereign/sdk";

import { parseMissionSnapshot, validateMissionInput, type MissionSnapshot } from "./model.ts";

const keyFor = (sessionId: string) => `mission.${sessionId}`;
const writes = new Map<string, Promise<unknown>>();

/**
 * Запись не состоялась, потому что снимок сменился под писателем. Отдельный класс, а не общая
 * ошибка: вызывающему нужен не только факт отказа, но и снимок, с которым он разошёлся, — иначе
 * слить свои изменения с чужими не с чем.
 */
export class MissionConflictError extends Error {
  /** Ожидание писателя и то, что лежит на самом деле: сливать изменения не с чем без обоих. */
  expectedRevision: number;
  current: MissionSnapshot | undefined;

  constructor(expectedRevision: number, current: MissionSnapshot | undefined) {
    const found =
      current === undefined ? "there is no mission yet" : `the stored one is ${current.revision}`;

    super(`expected revision ${expectedRevision}, but ${found}`);
    this.name = "MissionConflictError";
    this.expectedRevision = expectedRevision;
    this.current = current;
  }
}

export async function readMission(sessionId: string): Promise<MissionSnapshot | undefined> {
  const value = await storage.get(keyFor(sessionId));

  return value === undefined ? undefined : parseMissionSnapshot(value);
}

/**
 * Очередь на сессию упорядочивает записи одного воркера, но не защищает от расхождения: она живёт в
 * памяти процесса, а `storage` читается и пишется двумя отдельными вызовами. Поэтому у писателя есть
 * `expectedRevision`: с ним разошедшаяся запись становится отказом, который видно, а без него —
 * молчаливым затиранием чужого плана.
 */
export async function writeMission(sessionId: string, value: unknown): Promise<MissionSnapshot> {
  const previous = writes.get(sessionId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const { expectedRevision, ...content } = validateMissionInput(value);
      const stored = await readMission(sessionId);

      if (expectedRevision !== undefined && (stored?.revision ?? 0) !== expectedRevision) {
        throw new MissionConflictError(expectedRevision, stored);
      }

      const snapshot: MissionSnapshot = {
        ...content,
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
