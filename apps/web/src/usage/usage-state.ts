import type { Session, SessionStats } from "@sovereign/protocol";

export type UsageRecord = {
  session: Session;
  stats: SessionStats;
};

export type UsageSnapshot = {
  /** Оба каталога прочитаны без файловых проблем; иначе полного знаменателя не существует. */
  catalogComplete: boolean;
  /** Число уникальных сессий в активном и архивном каталогах на момент чтения. */
  listedSessionCount: number;
  /** Только сессии, для которых демон вернул точную статистику. */
  records: UsageRecord[];
  /** Явные причины, по которым итог не охватывает весь прочитанный каталог. */
  problems: string[];
};

export type UsageState =
  | { status: "loading" }
  | { status: "ready"; snapshot: UsageSnapshot }
  | { status: "failed"; failure: string };

export const initialUsageState: UsageState = { status: "loading" };

export function receiveUsage(_state: UsageState, snapshot: UsageSnapshot): UsageState {
  return { status: "ready", snapshot };
}

export function usageFailed(_state: UsageState, failure: string): UsageState {
  return { status: "failed", failure };
}

export type UsageSummary = {
  sessions: number;
  messages: number;
  cachedTokens: number;
  uncachedTokens: number;
  totalTokens: number;
  cost: number;
};

export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  return records.reduce<UsageSummary>(
    (summary, { stats }) => ({
      sessions: summary.sessions + 1,
      messages: summary.messages + stats.messageCount,
      cachedTokens: summary.cachedTokens + stats.cachedTokens,
      uncachedTokens: summary.uncachedTokens + stats.uncachedTokens,
      totalTokens: summary.totalTokens + stats.totalTokens,
      cost: summary.cost + stats.costTotal,
    }),
    {
      sessions: 0,
      messages: 0,
      cachedTokens: 0,
      uncachedTokens: 0,
      totalTokens: 0,
      cost: 0,
    },
  );
}
