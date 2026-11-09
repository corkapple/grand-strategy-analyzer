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
