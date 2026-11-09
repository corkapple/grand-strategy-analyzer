import { httpFetch } from "../providers/http";
import { COMMUNITY_URL } from "./config";
import type { Sample } from "./sample";

export interface CommunityGroup {
  enemy: string;
  /** Troop type the attack was led with. */
  lead: string;
  n: number;
  wins: number;
  winRate: number;
  avgOurLoss: number;
  medianOurLoss: number | null;
  avgEnemyLoss: number;
  medianWinRatio: number | null;
  cheapWins: number;
}
export interface CommunityStats {
  generatedAt: string | null;
  samples: number;
  groups: CommunityGroup[];
}

/** A group needs at least this many reports before the app shows it as a statistic. */
export const MIN_COMMUNITY_N = 10;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error("timed out")), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

export async function postSample(s: Sample): Promise<boolean> {
  if (!COMMUNITY_URL) return false;
  try {
    const res = await withTimeout(
      httpFetch(`${COMMUNITY_URL}/v1/samples`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }),
      15_000,
    );
    return res.ok || res.status === 400; // a rejected sample will never succeed, so do not retry it forever
  } catch {
    return false;
  }
}

export async function fetchStats(): Promise<CommunityStats | null> {
  if (!COMMUNITY_URL) return null;
  try {
    const res = await withTimeout(httpFetch(`${COMMUNITY_URL}/v1/stats`), 15_000);
    if (!res.ok) return null;
    const data = (await withTimeout(res.json(), 15_000)) as CommunityStats;
    return Array.isArray(data?.groups) ? data : null;
  } catch {
    return null;
  }
}

/** Stats for one enemy type and the troop type we lead with, once enough reports exist. */
export function communityFor(stats: CommunityStats | null, enemy: string, lead: string): CommunityGroup | null {
  const g = stats?.groups.find((x) => x.enemy === enemy && x.lead === lead);
  return g && g.n >= MIN_COMMUNITY_N ? g : null;
}
