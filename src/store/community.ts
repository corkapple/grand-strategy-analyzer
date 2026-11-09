import { create } from "zustand";
import { APP_VERSION, COMMUNITY_URL } from "@/lib/community/config";
import { fetchStats, postSample, type CommunityStats } from "@/lib/community/client";
import { buildSample, type Sample } from "@/lib/community/sample";
import { pairBattles } from "@/lib/history";
import { useHistory } from "@/store/history";
import { useSettings } from "@/store/settings";

const SHARED_KEY = "gsa-shared-ids";
const LAST_KEY = "gsa-last-shared";

function readIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHARED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeIds(ids: Set<string>) {
  try {
    localStorage.setItem(SHARED_KEY, JSON.stringify([...ids].slice(-2000)));
  } catch {
    /* storage unavailable: worst case a battle is offered again */
  }
}

interface CommunityState {
  stats: CommunityStats | null;
  /** The most recent payload that was (or would be) sent, so the user can see exactly what leaves. */
  lastSample: Sample | null;
  loadStats: () => Promise<void>;
  /** Share this battle (if sharing is on and it has a recon). Never throws. */
  shareBattle: (battleId: string) => Promise<void>;
  /** Retry battles that could not be sent earlier (offline, endpoint down). */
  flush: () => Promise<void>;
}

export const useCommunity = create<CommunityState>((set, get) => ({
  stats: null,
  lastSample: (() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as Sample | null;
    } catch {
      return null;
    }
  })(),
  loadStats: async () => {
    const stats = await fetchStats();
    if (stats) set({ stats });
  },
  shareBattle: async (battleId) => {
    if (!COMMUNITY_URL || !useSettings.getState().shareResults) return;
    const ids = readIds();
    if (ids.has(battleId)) return;
    const pair = pairBattles(useHistory.getState().records).find((p) => p.battle.id === battleId);
    const sample = pair && buildSample(pair, APP_VERSION, new Date(), useSettings.getState().strategy.formations);
    if (!sample) return; // needs a matching recon to be useful; retried later if one arrives
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(sample));
    } catch {
      /* ignore */
    }
    set({ lastSample: sample });
    if (await postSample(sample)) {
      ids.add(battleId);
      writeIds(ids);
    }
  },
  flush: async () => {
    if (!COMMUNITY_URL || !useSettings.getState().shareResults) return;
    const ids = readIds();
    for (const p of pairBattles(useHistory.getState().records)) {
      if (!ids.has(p.battle.id) && p.recon) await get().shareBattle(p.battle.id);
    }
  },
}));
