import { describe, expect, it } from "vitest";
import type { BattleRecord, ReconRecord } from "./history";
import { pairBattles } from "./history";
import { analyzeRules, analyzeThresholds, buffEdge, MIN_BATTLES } from "./insights";
import { parseBattleReport, parseCombatReport } from "./schema";
import { DEFAULT_STRATEGY } from "./strategy";

let seq = 0;
const recon = (x: number, mix: Partial<Record<"bruisers" | "hitmen" | "bikers", number>>): ReconRecord => ({
  id: `r${seq++}`,
  kind: "recon",
  createdAt: Date.now(),
  thumbs: [],
  report: parseCombatReport(
    JSON.stringify({
      timestamp: "01-01 10:00",
      location: { server: 1, x, y: 1 },
      wallDurability: { current: 1000, max: 1000 },
      traps: { lacerator: 100, pineappleGrenade: 0, napalmBomb: 0, total: 100 },
      associates: { bruisers: 0, hitmen: 0, bikers: 0, mortars: 0, ...mix, total: 1000 },
    }),
  ),
});
const battle = (
  x: number,
  formation: string,
  result: "victory" | "defeat",
  opts: { atkBuff?: number; defBuff?: number; traps?: number; type?: "solo" | "rally" } = {},
): BattleRecord => ({
  id: `b${seq++}`,
  kind: "battle",
  createdAt: Date.now(),
  thumbs: [],
  attackType: opts.type,
  report: parseBattleReport(
    JSON.stringify({
      result,
      timestamp: "01-01 11:00",
      location: { server: 1, x, y: 1 },
      attacker: { formation, totalAssociates: 1000, wounded: 5, dead: 5 },
      defender: { totalAssociates: 1000, dead: 500 },
      traps: { total: opts.traps ?? 100, destroyed: 10, remaining: 90 },
      wallDurability: 1000,
      buffs: [{ stat: "Crew ATK", attacker: opts.atkBuff ?? 100, defender: opts.defBuff ?? 100 }],
    }),
  ),
});

/** n paired battles against a Biker-heavy defense (rule: lead with Hitmen). */
function series(n: number, formation: string, result: "victory" | "defeat", opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = 1000 + seq;
    out.push(recon(x, { bikers: 900, hitmen: 100 }), battle(x, formation, result, opts));
  }
  return out;
}
const analyze = (recs: (ReconRecord | BattleRecord)[]) => analyzeRules(pairBattles(recs), DEFAULT_STRATEGY);

describe("analyzeRules", () => {
  it("asks for more data below the minimum", () => {
    const a = analyze(series(MIN_BATTLES - 1, "Hitman - Wedge", "victory"));
    expect(a.insights[0].status).toBe("need-data");
  });
  it("marks the rule supported after enough wins", () => {
    const a = analyze(series(MIN_BATTLES, "Hitman - Wedge", "victory"));
    expect(a.insights[0]).toMatchObject({ enemy: "bikers", status: "supported" });
  });
  it("flags a rule that keeps losing", () => {
    const a = analyze(series(MIN_BATTLES, "Hitman - Wedge", "defeat"));
    expect(a.insights[0].status).toBe("questionable");
  });
  it("never proposes changing the matchup chart; reports off-chart wins as likely buff effects", () => {
    const recs = [
      ...series(MIN_BATTLES, "Hitman - Wedge", "defeat"),
      ...series(MIN_BATTLES, "Bruiser - Wedge", "victory"),
    ];
    const ins = analyze(recs).insights[0];
    expect(ins.status).toBe("off-triangle");
    expect(ins).not.toHaveProperty("suggestCounter");
    expect(ins.message).toMatch(/buffs or troop numbers/);
  });
  it("discounts wins where the attacker had a big buff edge", () => {
    const a = analyze(series(MIN_BATTLES, "Hitman - Wedge", "victory", { atkBuff: 1200, defBuff: 100 }));
    expect(a.usable).toBe(0);
    expect(a.skipped.buffAdvantaged).toBe(MIN_BATTLES);
    expect(a.insights).toHaveLength(0);
  });
  it("skips mixed defenses and battles without a recon", () => {
    const mixed = [recon(1, { bruisers: 400, hitmen: 300, bikers: 300 }), battle(1, "Hitman - Wedge", "victory")];
    const lone = [battle(2, "Hitman - Wedge", "victory")];
    const a = analyze([...mixed, ...lone]);
    expect(a.skipped).toMatchObject({ mixedDefense: 1, noRecon: 1 });
  });
  it("computes buff edge", () => {
    expect(buffEdge(battle(1, "x", "victory", { atkBuff: 325.3, defBuff: 1200 }).report)).toBeCloseTo(-874.7);
  });
});

describe("analyzeThresholds", () => {
  it("suggests raising the solo limit after a solo win above it", () => {
    const b = battle(1, "Hitman - Wedge", "victory", { traps: 124_995, type: "solo" });
    const { insights, solo } = analyzeThresholds([b], DEFAULT_STRATEGY);
    expect(solo).toBe(1);
    const t = insights.find((i) => i.key === "soloMaxTraps")!;
    expect(t.suggested).toBe(130_000);
  });
  it("suggests lowering after a solo loss below the limit", () => {
    const b = battle(1, "Hitman - Wedge", "defeat", { traps: 20_000, type: "solo" });
    const t = analyzeThresholds([b], DEFAULT_STRATEGY).insights.find((i) => i.key === "soloMaxTraps")!;
    expect(t.suggested).toBe(18_000);
  });
  it("ignores unlabelled and rally battles", () => {
    const rally = battle(1, "Hitman - Wedge", "victory", { traps: 124_995, type: "rally" });
    const none = battle(2, "Hitman - Wedge", "victory", { traps: 124_995 });
    expect(analyzeThresholds([rally, none], DEFAULT_STRATEGY).insights).toHaveLength(0);
  });
});
