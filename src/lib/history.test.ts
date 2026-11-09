import { describe, expect, it } from "vitest";
import {
  effectiveLossRatio,
  matchupStats,
  pairBattles,
  parseGameTime,
  recommendedLead,
  troopFromFormation,
  type BattleRecord,
  type ReconRecord,
} from "./history";
import { parseBattleReport, parseCombatReport } from "./schema";

// Values read from the 21:13 recon and 21:25 victory screenshots.
const recon = parseCombatReport(
  JSON.stringify({
    reportType: "recon",
    timestamp: "11-08 21:13",
    location: { server: 1, x: 101, y: 201 },
    building: { name: "Elite Police Station", level: 8 },
    enforcers: { count: 5 },
    wallDurability: { current: 2500000, max: 2500000 },
    traps: { lacerator: 16145, pineappleGrenade: 104080, napalmBomb: 4775, total: 125000 },
    associates: { bruisers: 322900, hitmen: 95500, bikers: 2081600, mortars: 0, total: 2500000 },
  }),
);
const battle = parseBattleReport(`\`\`\`json
{"result":"victory","timestamp":"11-08 21:25",
 "location":{"server":1,"x":101,"y":201},
 "target":{"name":"Elite Police Station","level":8},
 "attacker":{"formation":"Hitman - Wedge","totalAssociates":"2,044,290","wounded":2951,"dead":1962,
   "alive":"2,039,377","casualtiesReduced":486579,"losses":"491,492","influence":"-176,868"},
 "defender":{"formation":"Bruiser - Square","totalAssociates":2500000,"wounded":0,"dead":622087,
   "alive":1877913,"casualtiesReduced":0,"losses":622087,"influence":"-22,568,577"},
 "traps":{"total":125000,"requiresRepair":0,"destroyed":34689,"remaining":90311},
 "wallDurability":2500000,
 "buffs":[{"stat":"Crew ATK","attacker":"+325.3%","defender":"+1200.0%"}]}
\`\`\``);

const reconRec: ReconRecord = { id: "r", kind: "recon", createdAt: Date.now(), thumbs: [], report: recon };
const battleRec: BattleRecord = { id: "b", kind: "battle", createdAt: Date.now(), thumbs: [], report: battle };

describe("battle parsing", () => {
  it("handles signed and comma strings and percent buffs", () => {
    expect(battle.attacker.influence).toBe(-176868);
    expect(battle.defender.influence).toBe(-22568577);
    expect(battle.attacker.totalAssociates).toBe(2044290);
    expect(battle.buffs[0]).toMatchObject({ attacker: 325.3, defender: 1200 });
  });
  it("uses wounded+dead, not the headline losses figure, as real losses", () => {
    expect(battle.attacker.losses).toBe(491492);
    expect(effectiveLossRatio(battle)).toBeCloseTo(4913 / 2044290, 6);
  });
});

describe("history helpers", () => {
  it("parses game timestamps", () => {
    const ref = new Date(2026, 10, 8, 22, 0).getTime();
    expect(new Date(parseGameTime("11-08 21:25", ref)!).getHours()).toBe(21);
    expect(parseGameTime("garbage", ref)).toBeNull();
  });
  it("maps formation text to troop type", () => {
    expect(troopFromFormation("Hitman - Wedge")).toBe("hitmen");
    expect(troopFromFormation("Bruiser - Square")).toBe("bruisers");
    expect(troopFromFormation(null)).toBeNull();
  });
  it("pairs a battle with the latest earlier recon of the same coordinates", () => {
    const other: ReconRecord = {
      ...reconRec,
      id: "r2",
      report: { ...recon, timestamp: "11-08 20:41", location: { server: 1, x: 102, y: 202 } },
    };
    const pairs = pairBattles([other, reconRec, battleRec]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].recon?.id).toBe("r");
  });
  it("does not pair a recon taken after the battle", () => {
    const late: ReconRecord = { ...reconRec, report: { ...recon, timestamp: "11-08 23:00" } };
    expect(pairBattles([late, battleRec])[0].recon).toBeNull();
  });
  it("does not reuse a recon for a second attack on the same target (the defense changed)", () => {
    const second: BattleRecord = { ...battleRec, id: "b2", report: { ...battle, timestamp: "11-08 22:00" } };
    const pairs = pairBattles([reconRec, battleRec, second]);
    const byId = Object.fromEntries(pairs.map((p) => [p.battle.id, p.recon?.id ?? null]));
    expect(byId).toEqual({ b: "r", b2: null });
  });
  it("pairs the second attack once a fresh recon exists", () => {
    const second: BattleRecord = { ...battleRec, id: "b2", report: { ...battle, timestamp: "11-08 22:00" } };
    const fresh: ReconRecord = { ...reconRec, id: "r2", report: { ...recon, timestamp: "11-08 21:50" } };
    const byId = Object.fromEntries(pairBattles([reconRec, battleRec, fresh, second]).map((p) => [p.battle.id, p.recon?.id ?? null]));
    expect(byId).toEqual({ b: "r", b2: "r2" });
  });
  it("aggregates matchups: Hitmen vs a Biker-heavy defense followed the advice and won", () => {
    const stats = matchupStats(pairBattles([reconRec, battleRec]), (r) => recommendedLead(r));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ enemy: "bikers", ours: "hitmen", n: 1, wins: 1, followedAdvice: 1 });
  });
});

import { leadTroop } from "./history";

describe("leadTroop: what the attack was led with", () => {
  const withFormation = (formation: string | null, troops?: Record<string, number>) =>
    parseBattleReport(
      JSON.stringify({
        result: "victory",
        attacker: { formation, totalAssociates: 2359550, wounded: 1409, dead: 934, alive: 2357207, troops },
        defender: { formation: "Bruiser - Square", totalAssociates: 2500000 },
      }),
    );
  it("reads the troops actually fielded: 2.36M Bikers under 'Hitman - Square' is a Biker attack", () => {
    const b = withFormation("Hitman - Square", { bruisers: 0, hitmen: 83, bikers: 2359455, mortars: 0 });
    expect(leadTroop(b)).toBe("bikers");
  });
  it("without troop numbers, uses the formation the app pairs with exactly one troop type", () => {
    expect(leadTroop(withFormation("Hitman - Square"))).toBe("bikers"); // how Bikers are sent
    expect(leadTroop(withFormation("Hitman - Wedge"))).toBe("hitmen");
    expect(leadTroop(withFormation("Bruiser - Wedge"))).toBe("bruisers");
  });
  it("ignores attacker troops that add up to the enemy's army, not ours (a model copied the wrong column)", () => {
    // Our army is 1.74M Bikers sent as "Hitman - Square"; the model returned the DEFENDER's 2.5M Bruiser-heavy column.
    const b = parseBattleReport(
      JSON.stringify({
        result: "victory",
        attacker: { formation: "Hitman - Square", totalAssociates: 1738596, troops: { bruisers: 2439200, hitmen: 25100, bikers: 35700, mortars: 0 } },
        defender: { formation: "Bruiser - Square", totalAssociates: 2500000 },
      }),
    );
    expect(leadTroop(b)).toBe("bikers"); // from the formation instead
  });
  it("accepts unambiguous names and leaves the rest unknown", () => {
    expect(leadTroop(withFormation("Biker - Square"))).toBe("bikers");
    expect(leadTroop(withFormation("Bruiser - Square"))).toBe("bruisers");
    expect(leadTroop(withFormation(null))).toBeNull();
    expect(leadTroop(withFormation("Something else"))).toBeNull();
  });
  it("matches the formations in the user's settings, including the app's explanatory suffix", () => {
    const f = { hitmen: "Hitman - Wedge", bikers: "Hitman - Square (shooters in front)", bruisers: "Bruiser - Wedge", mortars: "none" };
    expect(leadTroop(withFormation("Hitman - Square"), f)).toBe("bikers");
  });
  it("parses the troop mix from a model reply, with separators", () => {
    const b = parseBattleReport(
      '{"result":"victory","attacker":{"formation":"Hitman - Square","totalAssociates":"2,359,550","troops":{"bruisers":0,"hitmen":"41","bikers":"2,359,455","mortars":0}},"defender":{"totalAssociates":2500000,"troops":{"bruisers":"1,921,000","hitmen":"110,200","bikers":"468,800","mortars":0}}}',
    );
    expect(b.attacker.troops?.bikers).toBe(2359455);
    expect(b.defender.troops?.bruisers).toBe(1921000);
  });
});

import { syntheticRecon } from "./history";

describe("battles without a recon (enemy mix from Battle Details)", () => {
  const lone = (defender: Record<string, unknown>, attacker: Record<string, unknown> = {}): BattleRecord => ({
    id: "bd",
    kind: "battle",
    createdAt: Date.now(),
    thumbs: [],
    report: parseBattleReport(
      JSON.stringify({
        result: "victory",
        timestamp: "11-08 22:49",
        location: { server: 1, x: 101, y: 201 },
        target: { name: "Police Station", level: 8 },
        attacker: { formation: "Hitman - Square", totalAssociates: 1738596, wounded: 1303, dead: 864, alive: 1736429, losses: 217078, casualtiesReduced: 214911, troops: { bruisers: 42, hitmen: 41, bikers: 1738513, mortars: 0 }, ...attacker },
        defender: { formation: "Bruiser - Square", totalAssociates: 2500000, wounded: 0, dead: 1600638, alive: 899362, losses: 1600638, troops: { bruisers: 2439200, hitmen: 25100, bikers: 35700, mortars: 0 }, ...defender },
        traps: { total: 125000, destroyed: 15154, remaining: 109846 },
        wallDurability: 2500000,
      }),
    ),
  });

  it("builds an enemy mix from the defender's troops", () => {
    const r = syntheticRecon(lone({}))!;
    expect(r.synthetic).toBe(true);
    expect(r.report.associates).toEqual({ bruisers: 2439200, hitmen: 25100, bikers: 35700, mortars: 0, total: 2500000 });
    expect(r.report.traps.total).toBe(125000);
    expect(r.report.location).toEqual({ server: 1, x: 101, y: 201 });
  });
  it("pairs a lone battle with that enemy mix, and the lead troop is the Bikers actually sent", () => {
    const pairs = pairBattles([lone({})]);
    expect(pairs[0].recon?.synthetic).toBe(true);
    const stats = matchupStats(pairs, (r) => recommendedLead(r));
    expect(stats[0]).toMatchObject({ enemy: "bruisers", ours: "bikers", n: 1, wins: 1, followedAdvice: 1 });
  });
  it("does not invent an enemy when the troops do not add up to the defender's army", () => {
    expect(syntheticRecon(lone({ troops: { bruisers: 100, hitmen: 0, bikers: 0, mortars: 0 } }))).toBeNull();
    expect(pairBattles([lone({ troops: { bruisers: 100, hitmen: 0, bikers: 0, mortars: 0 } })])[0].recon).toBeNull();
  });
  it("needs the troops: without them a lone battle stays unpaired, as before", () => {
    const b = lone({});
    b.report.defender.troops = null;
    expect(pairBattles([b])[0].recon).toBeNull();
  });
  it("prefers a real recon over the Battle Details mix", () => {
    const b = lone({});
    const real: ReconRecord = { ...reconRec, id: "real", report: { ...recon, timestamp: "11-08 22:30", location: { server: 1, x: 101, y: 201 } } };
    const pair = pairBattles([real, b])[0];
    expect(pair.recon?.id).toBe("real");
    expect(pair.recon?.synthetic).toBeUndefined();
  });
});
