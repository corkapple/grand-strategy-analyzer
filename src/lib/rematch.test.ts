import { describe, expect, it } from "vitest";
import { rematchAdvice } from "./rematch";
import { parseBattleReport, parseCombatReport } from "./schema";
import { DEFAULT_STRATEGY } from "./strategy";

const enemy = (over: Record<string, number>) =>
  parseCombatReport(
    JSON.stringify({
      reportType: "recon",
      associates: { bruisers: 200000, hitmen: 1300000, bikers: 750000, mortars: 0, total: 2250000, ...over },
      traps: { total: 112500, lacerator: 1, pineappleGrenade: 1, napalmBomb: 1 },
      wallDurability: { current: 2250000, max: 2250000 },
    }),
  );
const battle = (result: "victory" | "defeat", troops: number[], formation = "Bruiser - Square") =>
  parseBattleReport(
    JSON.stringify({
      result,
      attacker: { formation, totalAssociates: 1022831, wounded: 3720, dead: 2477, alive: 1016634, casualtiesReduced: 613796, losses: 619993, troopRows: troops },
      defender: { formation: "Bruiser - Square", totalAssociates: 2250000, dead: 243256, alive: 2006744, losses: 243256 },
    }),
  );

describe("how to win after a defeat", () => {
  it("names the counter when we led with the wrong troops (Bikers against a Hitmen-heavy defense)", () => {
    const a = rematchAdvice(battle("defeat", [10, 12, 1022809]), enemy({}), DEFAULT_STRATEGY);
    expect(a.lost).toBe(true);
    expect(a.headline).toMatch(/lost this fight/);
    const text = a.lines.join(" ");
    expect(text).toMatch(/mostly Hitmen/);
    expect(text).toMatch(/You led with Bikers, but the counter to that is Bruisers/);
    expect(text).toMatch(/Send 100% Bruisers in Bruiser - Wedge/);
    expect(text).toMatch(/0\.45x their army/);
  });
  it("blames the numbers, not the matchup, when we led with the right troops and still lost", () => {
    const a = rematchAdvice(battle("defeat", [1022800, 20, 11]), enemy({}), DEFAULT_STRATEGY);
    const text = a.lines.join(" ");
    expect(text).toMatch(/Bruisers was the right lead/);
    expect(text).toMatch(/came down to numbers/);
  });
  it("does not claim what you led with when your troop rows were not read (only the formation is known)", () => {
    const a = rematchAdvice(battle("defeat", [], "Bruiser - Square"), enemy({}), DEFAULT_STRATEGY);
    const text = a.lines.join(" ");
    expect(text).not.toMatch(/You led with|right lead|came down to numbers/);
    expect(text).toMatch(/could not be read from Battle Details, so check you led with Bruisers/);
    expect(text).toMatch(/Send 100% Bruisers/);
  });
  it("gives a plain next-attack plan after a win", () => {
    const a = rematchAdvice(battle("victory", [1022800, 20, 11]), enemy({}), DEFAULT_STRATEGY);
    expect(a.lost).toBe(false);
    expect(a.headline).toMatch(/Next attack/);
    expect(a.lines.join(" ")).not.toMatch(/came down to numbers/);
  });
});

import { pairBattles, type BattleRecord, type ReconRecord } from "./history";
import { smallestCounterWin } from "./rematch";

describe("how many associates to bring (from your own wins)", () => {
  // A fight on its own target (x, y): enemy mix, what we sent (troop rows), our army, our real losses.
  const fight = (x: number, y: number, mix: [number, number, number], rows: [number, number, number], ours: number, dead: number, result: "victory" | "defeat" = "victory") => {
    const total = mix[0] + mix[1] + mix[2];
    const r: ReconRecord = {
      id: `r${x}`, kind: "recon", createdAt: 1, thumbs: [],
      report: parseCombatReport(JSON.stringify({ reportType: "recon", timestamp: "11-08 10:00", location: { server: 1, x, y }, associates: { bruisers: mix[0], hitmen: mix[1], bikers: mix[2], mortars: 0, total }, traps: { total: 1 }, wallDurability: { current: 1, max: 1 } })),
    };
    const b: BattleRecord = {
      id: `b${x}`, kind: "battle", createdAt: 2, thumbs: [],
      report: parseBattleReport(JSON.stringify({ result, timestamp: "11-08 10:30", location: { server: 1, x, y }, attacker: { formation: "Bruiser - Square", totalAssociates: ours, wounded: 0, dead, alive: ours - dead, losses: dead, troopRows: rows }, defender: { totalAssociates: total } })),
    };
    return [r, b];
  };
  const cfg = DEFAULT_STRATEGY;

  it("uses the smallest counter-matched win with acceptable losses", () => {
    const records = [
      ...fight(1, 1, [200000, 1300000, 750000], [1500000, 0, 0], 1500000, 3000), // Bruisers vs Hitmen-heavy: counter, 0.67x
      ...fight(2, 2, [200000, 1300000, 750000], [1300000, 0, 0], 1300000, 3000), // counter, 0.58x  <- smallest
      ...fight(3, 3, [200000, 1300000, 750000], [0, 0, 900000], 900000, 3000), // Bikers vs Hitmen-heavy: NOT the counter
      ...fight(4, 4, [200000, 1300000, 750000], [1000000, 0, 0], 1000000, 400000), // counter but 40% losses: too costly
      ...fight(5, 5, [200000, 1300000, 750000], [900000, 0, 0], 900000, 3000, "defeat"), // a defeat
    ];
    const w = smallestCounterWin(pairBattles(records), cfg, 0.1)!;
    expect(w.n).toBe(2);
    expect(w.ratio).toBeCloseTo(1300000 / 2250000, 3);
  });
  it("turns it into a number for the rematch: bring about this many, you sent this many", () => {
    const records = [...fight(2, 2, [200000, 1300000, 750000], [1300000, 0, 0], 1300000, 3000)];
    const lost = fight(9, 9, [640600, 1359900, 249500], [1022830, 0, 1], 1022831, 2477, "defeat");
    const a = rematchAdvice(lost[1].report as never, lost[0].report as never, cfg, { pairs: pairBattles(records), lossCap: 0.1 });
    const text = a.lines.join(" ");
    expect(text).toMatch(/Your 1 counter-matched win so far used at least 0\.58x/);
    expect(text).toMatch(/about 1,300,000 associates/);
    expect(text).toMatch(/You sent 1,022,831, so bring about 277,169 more/);
  });
  it("says nothing about army size when there is no comparable win yet", () => {
    const lost = fight(9, 9, [640600, 1359900, 249500], [1022830, 0, 1], 1022831, 2477, "defeat");
    const a = rematchAdvice(lost[1].report as never, lost[0].report as never, cfg, { pairs: [], lossCap: 0.1 });
    expect(a.lines.join(" ")).not.toMatch(/counter-matched win/);
  });
});

describe("what you say you led with beats a guess", () => {
  it("is used for the advice when the troop rows could not be read", () => {
    const b = battle("defeat", [], "Bruiser - Square");
    const withoutAnswer = rematchAdvice(b, enemy({}), DEFAULT_STRATEGY).lines.join(" ");
    expect(withoutAnswer).toMatch(/could not be read from Battle Details/);
    const wrong = rematchAdvice(b, enemy({}), DEFAULT_STRATEGY, undefined, "bikers").lines.join(" ");
    expect(wrong).toMatch(/You led with Bikers, but the counter to that is Bruisers/);
    const right = rematchAdvice(b, enemy({}), DEFAULT_STRATEGY, undefined, "bruisers").lines.join(" ");
    expect(right).toMatch(/Bruisers was the right lead/);
    expect(right).toMatch(/came down to numbers/);
  });
});
