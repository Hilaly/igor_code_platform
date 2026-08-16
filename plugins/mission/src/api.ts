import type { MissionSnapshot } from "./model.ts";

export async function fetchMission(
  sessionId: string,
  signal?: AbortSignal,
): Promise<MissionSnapshot | undefined> {
  const response = await fetch(`/api/p/mission/${encodeURIComponent(sessionId)}`, { signal });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as MissionSnapshot;
}
