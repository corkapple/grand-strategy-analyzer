import { describe, expect, it } from "vitest";
import { aggregate, enemyKey as serverKey } from "../../../scripts/community-aggregate.mjs";
import { validateSample } from "../../../inbox/validate.mjs";
import { parseBattleReport, parseCombatReport } from "../schema";
import { pairBattles, type BattleRecord, type ReconRecord } from "../history";
import { communityFor, MIN_COMMUNITY_N } from "./client";
import { enemyKey } from "./enemyKey";
import { buildSample } from "./sample";

const recon = parseCombatReport(
  JSON.stringify({
    reportType: "recon",
    timestamp: "11-08 21:13",
    location: { server: 1, x: 101, y: 201 },
    building: { name: "Elite Police Station", level: 8 },
    wallDurability: { current: 2500000, max: 2500000 },
    traps: { lacerator: 16145, pineappleGrenade: 104080, napalmBomb: 4775, total: 125000 },
    associates: { bruisers: 322900, hitmen: 95500, bikers: 2081600, mortars: 0, total: 2500000 },
  }),
);
const battle = parseBattleReport(
  JSON.stringify({
    result: "victory",
    timestamp: "11-08 21:25",
    location: { server: 1, x: 101, y: 201 },
    target: { name: "Elite Police Station", level: 8 },
    attacker: { formation: "Hitman - Wedge", totalAssociates: 2044290, wounded: 2951, dead: 1962, alive: 2039377, casualtiesReduced: 486579, losses: 491492, influence: -176868 },
    defender: { formation: "Bruiser - Square", totalAssociates: 2500000, wounded: 0, dead: 622087, alive: 1877913, casualtiesReduced: 0, losses: 622087, influence: -22568577 },
    traps: { total: 125000, requiresRepair: 0, destroyed: 34689, remaining: 90311 },
    wallDurability: 2500000,
    buffs: [{ stat: "Crew ATK", attacker: 325.3, defender: 1200 }],
  }),
);
const rr: ReconRecord = { id: "r", kind: "recon", createdAt: Date.now(), thumbs: [], report: recon };
const br: BattleRecord = { id: "b", kind: "battle", createdAt: Date.now(), thumbs: [], report: battle };

describe("sample", () => {
  const pair = pairBattles([rr, br])[0];
  const s = buildSample(pair, "0.1.4", new Date("2026-11-09T10:00:00Z"))!;

  it("keeps only rounded numbers and passes the server's validation", () => {
    expect(s).toMatchObject({ v: 1, day: "2026-11-09", result: "victory", level: 8, formation: "Hitman - Wedge", lead: "hitmen", ours: 2050000, enemyTotal: 2500000 });
    expect(s.enemy).toEqual({ bruisers: 13, hitmen: 4, bikers: 83, mortars: 0 });
    expect(validateSample(s).ok).toBe(true);
  });
  it("contains nothing that identifies a player, a base or a time", () => {
    const text = JSON.stringify(s);
    for (const secret of ["Elite", "Police", "101", "201", "21:25"]) expect(text).not.toContain(secret);
  });
  it("needs a recon", () => {
    expect(buildSample({ battle: br, recon: null }, "x")).toBeNull();
  });
  it("is rejected by the server when it carries extra or malformed fields", () => {
    expect(validateSample({ ...s, name: "someone" }).ok).toBe(false);
    expect(validateSample({ ...s, result: "unknown" }).ok).toBe(false);
    expect(validateSample({ ...s, enemy: { ...s.enemy, bikers: 10 } }).ok).toBe(false);
    expect(validateSample({ ...s, formation: "free text here" }).ok).toBe(false);
    expect(validateSample("hello").ok).toBe(false);
  });
});

describe("aggregation", () => {
  const pair = pairBattles([rr, br])[0];
  const s = buildSample(pair, "0.1.4", new Date("2026-11-09T10:00:00Z"))!;
  it("uses the same majority rule as the app", () => {
    expect(serverKey(s.enemy)).toBe("bikers");
    expect(enemyKey({ bruisers: 0.1, hitmen: 0.04, bikers: 0.83 })).toBe("bikers");
    expect(enemyKey({ bruisers: 40, hitmen: 30, bikers: 30 })).toBe("mixed");
  });
  it("groups by enemy type and lead troop, ignores invalid samples and shows a threshold", () => {
    const many = Array.from({ length: MIN_COMMUNITY_N }, (_, i) => ({ ...s, result: i === 0 ? "defeat" : "victory", ourLoss: 0.02 }));
    const stats = aggregate([...many, { junk: true }]);
    expect(stats.samples).toBe(MIN_COMMUNITY_N);
    const g = stats.groups[0];
    expect(g).toMatchObject({ enemy: "bikers", lead: "hitmen", n: MIN_COMMUNITY_N, wins: MIN_COMMUNITY_N - 1 });
    expect(g.winRate).toBeCloseTo(0.9, 3);
    expect(communityFor(stats, "bikers", "hitmen")).not.toBeNull();
    expect(communityFor(aggregate([s]), "bikers", "hitmen")).toBeNull(); // too few reports
  });
});

describe("samples from v0.1.4 (no lead field)", () => {
  const pair = pairBattles([rr, br])[0];
  const s = buildSample(pair, "0.1.4", new Date("2026-11-09T10:00:00Z"))!;
  const { lead: _lead, ...old } = s;
  void _lead;
  it("are still accepted by the server", () => {
    expect(validateSample(old).ok).toBe(true);
    expect(validateSample({ ...s, lead: "bikers" }).ok).toBe(true);
    expect(validateSample({ ...s, lead: "someone" }).ok).toBe(false);
  });
  it("are grouped by the lead troop the app pairs with their formation", () => {
    const many = (formation: string) => Array.from({ length: MIN_COMMUNITY_N }, () => ({ ...old, formation }));
    const stats = aggregate([...many("Hitman - Square"), ...many("Hitman - Wedge")]);
    expect(stats.groups.map((g) => g.lead).sort()).toEqual(["bikers", "hitmen"]);
  });
});

describe("a battle counted from its Battle Details screen", () => {
  it("is shared with the enemy mix it showed, like a paired battle", () => {
    const withTroops = {
      ...br,
      id: "lone",
      report: { ...battle, defender: { ...battle.defender, troops: { bruisers: 2_439_200, hitmen: 25_100, bikers: 35_700, mortars: 0 } } },
    };
    const pair = pairBattles([withTroops])[0];
    expect(pair.recon?.synthetic).toBe(true);
    const sample = buildSample({ ...pair }, "0.1.8", new Date("2026-11-09T10:00:00Z"));
    expect(sample?.enemy).toEqual({ bruisers: 98, hitmen: 1, bikers: 1, mortars: 0 });
    expect(validateSample(sample).ok).toBe(true);
  });
});
