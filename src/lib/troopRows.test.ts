import { describe, expect, it } from "vitest";
import { leadTroop, pairBattles, syntheticRecon, type BattleRecord } from "./history";
import { parseBattleReport } from "./schema";
import { computeStrategy } from "./strategy";

// The real battle where Gemini put the numbers under the wrong troop types ("Bikers-heavy defense").
const reply = (over: { attacker?: object; defender?: object } = {}) =>
  JSON.stringify({
    result: "victory",
    timestamp: "11-09 09:41",
    location: { server: 1, x: 102, y: 202 },
    target: { name: "Police Station", level: 7 },
    attacker: { formation: "Bruiser - Square", totalAssociates: 1264985, wounded: 2682, dead: 1785, alive: 1260518, casualtiesReduced: 442429, losses: 446896, troopRows: [21, 13, 1264951], ...over.attacker },
    defender: { formation: "Bruiser - Square", totalAssociates: 2250000, wounded: 0, dead: 1091591, alive: 1158409, casualtiesReduced: 0, losses: 1091591, troopRows: [1355300, 579200, 315500], ...over.defender },
    traps: { total: 112500, destroyed: 38921, remaining: 73579 },
    wallDurability: 2250000,
  });
const rec = (b: ReturnType<typeof parseBattleReport>): BattleRecord => ({ id: "x", kind: "battle", createdAt: Date.now(), thumbs: [], report: b });

describe("troop types from the row order on Battle Details", () => {
  it("maps the three tier-4 rows to Bruisers, Hitmen, Bikers: the enemy is Bruiser-heavy, we sent Bikers", () => {
    const b = parseBattleReport(reply());
    expect(b.defender.troops).toEqual({ bruisers: 1355300, hitmen: 579200, bikers: 315500, mortars: 0 });
    expect(b.attacker.troops).toEqual({ bruisers: 21, hitmen: 13, bikers: 1264951, mortars: 0 });
    expect(leadTroop(b)).toBe("bikers"); // even though the formation is called "Bruiser - Square"
    const pair = pairBattles([rec(b)])[0];
    expect(computeStrategy(pair.recon!.report).dominant).toBe("bruisers");
  });
  it("does NOT second-guess the rows with the enemy's formation: a Bruiser-formation defense can be mostly Hitmen", () => {
    // Real data: a "Bruiser - Square" defense was 83% Bikers in the recon of the same target.
    const b = parseBattleReport(reply({ defender: { troopRows: [315500, 1355300, 579200] } }));
    expect(b.defender.troops).toEqual({ bruisers: 315500, hitmen: 1355300, bikers: 579200, mortars: 0 });
    expect(syntheticRecon(rec(b))).not.toBeNull();
  });
  it("does not use rows that do not match the army size (lower tiers dominate)", () => {
    const b = parseBattleReport(reply({ defender: { troopRows: [1000, 500, 200] } }));
    expect(b.defender.troops).toBeNull();
    expect(b.notes).toMatch(/do not match the army size/);
  });
  it("accepts a legitimate mismatch between formation and a minority row (formation not decisive without a clear majority)", () => {
    // 45/40/15: no row is a majority, so the formation cannot contradict it.
    const b = parseBattleReport(reply({ defender: { troopRows: [1012500, 900000, 337500] } }));
    expect(b.defender.troops?.bruisers).toBe(1012500);
  });
  it("still understands replies that give typed troops, with no rows", () => {
    const b = parseBattleReport(reply({ defender: { troopRows: null, troops: { bruisers: 1355300, hitmen: 579200, bikers: 315500, mortars: 0 } } }));
    expect(b.defender.troops?.bruisers).toBe(1355300);
  });
});
