// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BattleRecord } from "@/lib/history";
import { parseBattleReport } from "@/lib/schema";

const db = new Map<string, unknown>();
vi.mock("@/lib/historyDb", () => ({
  dbAll: async () => [...db.values()],
  dbPut: async (r: { id: string }) => void db.set(r.id, r),
  dbDelete: async (id: string) => void db.delete(id),
  dbClear: async () => db.clear(),
}));
vi.mock("@/lib/community/config", () => ({ COMMUNITY_URL: "https://inbox.example", APP_VERSION: "0.1.15" }));
const posted: unknown[] = [];
vi.mock("@/lib/community/client", () => ({
  postSample: async (s: unknown) => (posted.push(s), true),
  fetchStats: async () => null,
}));
vi.mock("@/lib/secrets", () => ({ inTauri: false, KEYS_ACCOUNT: "k", apiKeyAccount: (i: string) => i, getSecret: async () => null, setSecret: async () => undefined }));

const battle = (rows: number[]): BattleRecord => ({
  id: "b1",
  kind: "battle",
  createdAt: Date.now(),
  thumbs: [],
  report: parseBattleReport(
    JSON.stringify({
      result: "victory",
      timestamp: "11-09 09:41",
      location: { server: 1, x: 102, y: 202 },
      attacker: { formation: "Bruiser - Square", totalAssociates: 1264985, wounded: 2682, dead: 1785, alive: 1260518, casualtiesReduced: 442429, losses: 446896, troopRows: [21, 13, 1264951] },
      defender: { formation: "Bruiser - Square", totalAssociates: 2250000, dead: 1091591, alive: 1158409, losses: 1091591, troopRows: rows },
      traps: { total: 112500, destroyed: 38921, remaining: 73579 },
    }),
  ),
});

beforeEach(() => {
  db.clear();
  posted.length = 0;
  localStorage.clear();
  vi.resetModules();
});

describe("sharing a battle", () => {
  it("sends it once, not again when nothing changed, and again if the reading was corrected", async () => {
    const { useHistory } = await import("./history");
    const { useCommunity } = await import("./community");
    await useHistory.getState().add(battle([315500, 579200, 1355300].reverse())); // [1355300, 579200, 315500]
    await useCommunity.getState().shareBattle("b1");
    await useCommunity.getState().shareBattle("b1");
    expect(posted).toHaveLength(1);
    // The same fight analysed again with a corrected reading replaces the record and is sent once more.
    await useHistory.getState().add(battle([1355300, 500000, 394500]));
    await useCommunity.getState().shareBattle("b1");
    await useCommunity.getState().shareBattle("b1");
    expect(posted).toHaveLength(2);
  });
  it("re-sends a battle that an older version sent (its content is unknown), once", async () => {
    localStorage.setItem("gsa-shared-ids", JSON.stringify(["b1"]));
    const { useHistory } = await import("./history");
    const { useCommunity } = await import("./community");
    await useHistory.getState().add(battle([1355300, 579200, 315500]));
    await useCommunity.getState().shareBattle("b1");
    await useCommunity.getState().shareBattle("b1");
    expect(posted).toHaveLength(1);
  });
});
