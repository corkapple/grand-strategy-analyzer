// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BattleRecord, ReconRecord } from "@/lib/history";
import { parseBattleReport, parseCombatReport } from "@/lib/schema";

const db = new Map<string, unknown>();
vi.mock("@/lib/historyDb", () => ({
  dbAll: async () => [...db.values()],
  dbPut: async (r: { id: string }) => void db.set(r.id, r),
  dbDelete: async (id: string) => void db.delete(id),
  dbClear: async () => db.clear(),
}));

const battle = (id: string, over: Record<string, unknown> = {}): BattleRecord => ({
  id,
  kind: "battle",
  createdAt: Date.now(),
  thumbs: [],
  report: parseBattleReport(
    JSON.stringify({
      result: "victory",
      timestamp: "11-08 22:49",
      location: { server: 1, x: 101, y: 201 },
      attacker: { formation: "Hitman - Square", totalAssociates: 1738596, wounded: 1303, dead: 864, alive: 1736429, casualtiesReduced: 214911, losses: 217078 },
      defender: { formation: "Bruiser - Square", totalAssociates: 2500000, dead: 1600638, alive: 899362, losses: 1600638 },
      ...over,
    }),
  ),
});

beforeEach(() => {
  db.clear();
  vi.resetModules();
});

describe("analysing the same screenshots again", () => {
  it("updates the existing battle instead of adding a copy, and keeps your Solo/Rally label", async () => {
    const { useHistory } = await import("./history");
    const first = await useHistory.getState().add(battle("a"));
    await useHistory.getState().setAttackType("a", "solo");
    const again = await useHistory.getState().add(battle("b"));
    expect(again.id).toBe(first.id); // same event, same record (so it is not shared a second time)
    expect(useHistory.getState().records).toHaveLength(1);
    expect((useHistory.getState().records[0] as BattleRecord).attackType).toBe("solo");
  });
  it("still stores a different battle, and a battle with nothing to identify it", async () => {
    const { useHistory } = await import("./history");
    await useHistory.getState().add(battle("a"));
    await useHistory.getState().add(battle("b", { timestamp: "11-08 23:10" })); // another fight
    await useHistory.getState().add(battle("c", { timestamp: null }));
    await useHistory.getState().add(battle("d", { timestamp: null }));
    expect(useHistory.getState().records).toHaveLength(4);
  });
  it("treats a repeated recon the same way", async () => {
    const { useHistory } = await import("./history");
    const recon = (id: string): ReconRecord => ({
      id,
      kind: "recon",
      createdAt: Date.now(),
      thumbs: [],
      report: parseCombatReport(
        JSON.stringify({ reportType: "recon", timestamp: "11-08 22:30", location: { server: 1, x: 101, y: 201 }, associates: { bruisers: 2439200, hitmen: 25100, bikers: 35700, mortars: 0, total: 2500000 }, traps: { total: 125000, lacerator: 1, pineappleGrenade: 1, napalmBomb: 1 }, wallDurability: { current: 1, max: 1 } }),
      ),
    });
    await useHistory.getState().add(recon("r1"));
    await useHistory.getState().add(recon("r2"));
    expect(useHistory.getState().records).toHaveLength(1);
  });
});
