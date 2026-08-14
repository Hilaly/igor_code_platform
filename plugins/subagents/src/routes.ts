/**
 * Маршруты для панели (docs/subagents.md). Панель — браузерный код, а хранилище плагина и сессии
 * живут в воркере: другого способа показать записи у неё нет.
 *
 * Оба маршрута защищены платформенной сессией — это обычный `contribute.route`, а не публичный:
 * работа субагентов принадлежит хозяину машины.
 */

import { contribute, sessions, type SessionEntry } from "@sovereign/sdk";

import { listRecords, readRecord, type SubagentRecord } from "./registry.ts";

/** Строка списка глазами панели: запись плюс живая фаза сессии. */
export type SubagentListed = SubagentRecord & {
  /** Фазы нет, если сессию стёрли: запись переживает свою сессию. */
  phase?: string;
};

export type SubagentDetail = {
  record: SubagentRecord;
  entries: SessionEntry[];
  stats?: { totalTokens: number; costTotal: number; messageCount: number };
  /** Почему деталь неполна. Пустая лента у живой записи иначе выглядела бы как «ничего не делал». */
  problem?: string;
};

const json = (value: unknown) => ({
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(value),
});

export async function contributeRoutes(): Promise<void> {
  await contribute.route({
    id: "list",
    title: "Subagents",
    description: "Subagent records, newest first; ?parent= narrows them to one session.",
    method: "GET",
    path: "list",
    handle: async (request) => {
      const parent = request.query["parent"];
      const records = (await listRecords()).filter(
        (record) => parent === undefined || record.parentSessionId === parent,
      );
      const phases = new Map<string, string>();

      for (const projectId of new Set(records.map((record) => record.projectId))) {
        for (const session of await sessions.list(projectId)) {
          phases.set(session.id, session.phase);
        }
      }

      const listed: SubagentListed[] = records.map((record) => {
        const phase = phases.get(record.sessionId);

        return phase === undefined ? record : { ...record, phase };
      });

      return json({ subagents: listed });
    },
  });

  await contribute.route({
    id: "detail",
    title: "One subagent",
    description: "One subagent record together with its branch and its spend.",
    method: "GET",
    path: "detail/:sessionId",
    handle: async (request) => {
      const sessionId = request.parameters["sessionId"] ?? "";
      const record = await readRecord(sessionId);

      if (record === undefined) {
        return {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ error: `there is no subagent ${sessionId}` }),
        };
      }

      // Сессию могли стереть под записью: панель обязана показать запись всё равно, назвав
      // причину, — иначе строка списка открывалась бы в пустоту.
      try {
        const [branch, stats] = await Promise.all([
          sessions.branch(sessionId),
          sessions.stats(sessionId),
        ]);

        return json({
          record,
          entries: branch.entries,
          stats: {
            totalTokens: stats.totalTokens,
            costTotal: stats.costTotal,
            messageCount: stats.messageCount,
          },
        } satisfies SubagentDetail);
      } catch (cause) {
        return json({
          record,
          entries: [],
          problem: cause instanceof Error ? cause.message : String(cause),
        } satisfies SubagentDetail);
      }
    },
  });
}
