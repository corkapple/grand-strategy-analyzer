import { describe, expect, it } from "vitest";
import { pairBattles, type BattleRecord, type ReconRecord } from "./history";
import { armyNeeded, buildPlaybook, learningSummary } from "./playbook";
import { parseBattleReport, parseCombatReport } from "./schema";
import { DEFAULT_STRATEGY } from "./strategy";

let seq = 0;
const mixOf = (m: Partial<Record<"bruisers" | "hitmen" | "bikers", number>>, level = 8) =>
  parseCombatReport(
    JSON.stringify({
      building: { name: "Police Station", level },
      wallDurability: { current: 1, max: 1 },
      traps: { lacerator: 0, pineappleGrenade: 0, napalmBomb: 0, total: 0 },
      associates: { bruisers: 0, hitmen: 0, bikers: 0, mortars: 0, ...m, total: 1_000_000 },
    }),
  );

/** A recon + battle pair; `mine` = our associates, `lost` = wounded+dead. */
function fight(
  x: number,
  mix: Parameters<typeof mixOf>[0],
  formation: string,
  result: "victory" | "defeat",
  mine: number,
  lost: number,
  edge?: [number, number],
) {
  const recon: ReconRecord = {
    id: `r${seq++}`,
    kind: "recon",
    createdAt: Date.now(),
    thumbs: [],
    report: { ...mixOf(mix), timestamp: "01-01 10:00", location: { server: 1, x, y: 1 } },
  };
  const battle: BattleRecord = {
    id: `b${seq++}`,
    kind: "battle",
    createdAt: Date.now(),
    thumbs: [],
    report: parseBattleReport(
      JSON.stringify({
        result,
        timestamp: "01-01 11:00",
        location: { server: 1, x, y: 1 },
        attacker: { formation, totalAssociates: mine, wounded: lost, dead: 0 },
        defender: { totalAssociates: 1_000_000, dead: 500_000 },
        buffs: edge ? [{ stat: "Crew ATK", attacker: edge[0], defender: edge[1] }] : [],
      }),
    ),
  };
  return [recon, battle];
}
const pairsOf = (...fights: (ReconRecord | BattleRecord)[][]) => pairBattles(fights.flat());
const target = mixOf({ bruisers: 800_000, bikers: 100_000, hitmen: 100_000 });

describe("buildPlaybook", () => {
  it("surfaces a similar good win and flags a win against the chart as off-chart", () => {
    // Hitmen vs a Bruiser-heavy defense: the chart favours Bikers, so this is off-chart.
    const p = buildPlaybook(
      target,
      pairsOf(fight(1, { bruisers: 770_000, bikers: 110_000, hitmen: 120_000 }, "Hitman - Wedge", "victory", 800_000, 2_000, [325, 1200])),
      DEFAULT_STRATEGY,
    );
    expect(p.precedents).toHaveLength(1);
    expect(p.precedents[0]).toMatchObject({ lead: "hitmen", onChart: false, forceRatio: 0.8, buffEdge: -875 });
    expect(p.family.goodWins).toBe(1);
    expect(p.minRatioOffChart).toBe(0.8);
    expect(p.minRatioOnChart).toBeNull();
  });

  it("ranks the closer match first", () => {
    const p = buildPlaybook(
      target,
      pairsOf(
        fight(1, { bruisers: 500_000, hitmen: 500_000 }, "Biker - Square", "victory", 900_000, 1_000), // far mix
        fight(2, { bruisers: 790_000, bikers: 110_000, hitmen: 100_000 }, "Biker - Wedge", "victory", 700_000, 1_000), // close
      ),
      DEFAULT_STRATEGY,
    );
    expect(p.precedents[0].formation).toBe("Biker - Wedge");
  });

  it("does not use costly wins or defeats as precedents but counts them", () => {
    const p = buildPlaybook(
      target,
      pairsOf(
        fight(1, { bruisers: 800_000, hitmen: 200_000 }, "Biker - Wedge", "victory", 500_000, 200_000), // 40% lost
        fight(2, { bruisers: 800_000, hitmen: 200_000 }, "Hitman - Wedge", "defeat", 300_000, 250_000),
      ),
      DEFAULT_STRATEGY,
      0.1,
    );
    expect(p.precedents).toHaveLength(0);
    expect(p.family).toEqual({ goodWins: 0, costlyWins: 1, defeats: 1 });
  });

  it("small losses are fine: a win with 9% losses counts at a 10% cap, not at 5%", () => {
    const f = fight(1, { bruisers: 800_000, hitmen: 200_000 }, "Biker - Wedge", "victory", 1_000_000, 90_000);
    expect(buildPlaybook(target, pairsOf(f), DEFAULT_STRATEGY, 0.1).precedents).toHaveLength(1);
    expect(buildPlaybook(target, pairsOf(f), DEFAULT_STRATEGY, 0.05).precedents).toHaveLength(0);
  });

  it("tracks the smallest winning force ratio on-chart", () => {
    const p = buildPlaybook(
      target,
      pairsOf(
        fight(1, { bruisers: 800_000, hitmen: 200_000 }, "Biker - Wedge", "victory", 900_000, 1_000),
        fight(2, { bruisers: 800_000, hitmen: 200_000 }, "Biker - Square", "victory", 600_000, 1_000),
      ),
      DEFAULT_STRATEGY,
    );
    expect(p.minRatioOnChart).toBe(0.6);
  });

  it("scales the army needed to the target's size", () => {
    const p = buildPlaybook(
      target,
      pairsOf(fight(1, { bruisers: 800_000, hitmen: 200_000 }, "Biker - Wedge", "victory", 600_000, 1_000)),
      DEFAULT_STRATEGY,
    );
    expect(armyNeeded(p.precedents[0], 2_000_000)).toBe(1_200_000);
  });

  it("returns nothing when there is no history", () => {
    expect(buildPlaybook(target, [], DEFAULT_STRATEGY).precedents).toEqual([]);
  });
});

describe("learningSummary", () => {
  it("says what was learned from a good win", () => {
    const [recon, battle] = fight(1, { bruisers: 800_000, hitmen: 200_000 }, "Biker - Wedge", "victory", 900_000, 1_000);
    const msg = learningSummary(battle as BattleRecord, [recon, battle], DEFAULT_STRATEGY);
    expect(msg).toMatch(/Learned: a good win against a Bruisers-heavy defense/);
    expect(msg).toMatch(/Biker - Wedge/);
  });
  it("labels costly wins and defeats and explains missing recons", () => {
    const [r1, costly] = fight(1, { bruisers: 800_000, hitmen: 200_000 }, "Biker - Wedge", "victory", 500_000, 200_000);
    expect(learningSummary(costly as BattleRecord, [r1, costly], DEFAULT_STRATEGY)).toMatch(/costly win/);
    const [r2, loss] = fight(2, { bruisers: 800_000, hitmen: 200_000 }, "Hitman - Wedge", "defeat", 300_000, 250_000);
    expect(learningSummary(loss as BattleRecord, [r2, loss], DEFAULT_STRATEGY)).toMatch(/defeat/);
    expect(learningSummary(loss as BattleRecord, [loss], DEFAULT_STRATEGY)).toMatch(/No usable recon/);
  });
});
