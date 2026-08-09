/**
 * Экран аналитики читает существующие точные контракты. Отдельного серверного отчёта и временных
 * бакетов нет: два каталога дают множество сессий, а `/stats` — фактические токены и стоимость.
 */

import { fetchSessions, fetchStats } from "../sessions/api.ts";
import type { UsageRecord, UsageSnapshot } from "./usage-state.ts";

type StatsOutcome = { record: UsageRecord } | { problem: string };
const simultaneousStatsReads = 6;

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export async function fetchUsage(signal?: AbortSignal): Promise<UsageSnapshot> {
  const catalogs = await Promise.allSettled([
    fetchSessions(undefined, false, signal),
    fetchSessions(undefined, true, signal),
  ]);
  const labels = ["active sessions", "archived sessions"] as const;
  const failures = catalogs.flatMap((catalog, index) =>
    catalog.status === "rejected" ? [`${labels[index]}: ${reasonOf(catalog.reason)}`] : [],
  );

  if (catalogs.every((catalog) => catalog.status === "rejected")) {
    throw new Error(failures.join("; "));
  }

  const snapshots = catalogs.flatMap((catalog) =>
    catalog.status === "fulfilled" ? [catalog.value] : [],
  );
  const catalogProblems = snapshots.flatMap((snapshot) => snapshot.problems ?? []);
  const sessions = new Map(
    snapshots.flatMap((snapshot) => snapshot.sessions).map((session) => [session.id, session]),
  );
  const records: UsageRecord[] = [];
  const problems = new Set([...failures, ...catalogProblems]);

  const listed = [...sessions.values()];
  const outcomes = new Array<StatsOutcome>(listed.length);
  let nextIndex = 0;
  const readNext = async (): Promise<void> => {
    while (nextIndex < listed.length) {
      const index = nextIndex;
      nextIndex += 1;
      const session = listed[index];
      if (session === undefined) return;

      try {
        const stats = await fetchStats(session.id, signal);

        if (stats === undefined) {
          outcomes[index] = { problem: `${session.id}: statistics are no longer available` };
          continue;
        }

        outcomes[index] = { record: { session, stats } };
      } catch (cause) {
        if (signal?.aborted === true) {
          throw cause;
        }

        outcomes[index] = { problem: `${session.id}: ${reasonOf(cause)}` };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(simultaneousStatsReads, listed.length) }, readNext),
  );

  for (const outcome of outcomes) {
    if (outcome === undefined) continue;
    if ("record" in outcome) records.push(outcome.record);
    else problems.add(outcome.problem);
  }

  return {
    catalogComplete: failures.length === 0 && catalogProblems.length === 0,
    listedSessionCount: sessions.size,
    records,
    problems: [...problems],
  };
}
