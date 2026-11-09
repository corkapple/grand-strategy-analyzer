import { describe, expect, it } from "vitest";
import { repairSide } from "./identities";
import { parseBattleReport } from "./schema";

describe("repairSide: the game's arithmetic", () => {
  it("leaves consistent numbers alone", () => {
    const r = repairSide({ totalAssociates: 2044290, wounded: 2951, dead: 1962, alive: 2039377, casualtiesReduced: 486579, losses: 491492 });
    expect(r.changes).toEqual([]);
    expect(r.consistent).toBe(true);
  });
  it("repairs a misread Dead count (864 read as 64): both identities point to the same fix", () => {
    const r = repairSide({ totalAssociates: 1738596, wounded: 1303, dead: 64, alive: 1736429, casualtiesReduced: 214911, losses: 217078 });
    expect(r.side.dead).toBe(864);
    expect(r.consistent).toBe(true);
    expect(r.changes[0]).toMatch(/dead 64 -> 864/);
  });
  it("fills an Alive count the model left at 0", () => {
    const r = repairSide({ totalAssociates: 2500000, wounded: 0, dead: 1600638, alive: 0, casualtiesReduced: 0, losses: 1600638 });
    expect(r.side.alive).toBe(899362);
    expect(r.consistent).toBe(true);
  });
  it("fills both Alive and Losses when the model returned 0 for both", () => {
    const r = repairSide({ totalAssociates: 2500000, wounded: 0, dead: 1600638, alive: 0, casualtiesReduced: 0, losses: 0 });
    expect(r.side.alive).toBe(899362);
    expect(r.side.losses).toBe(1600638);
    expect(r.consistent).toBe(true);
  });
  it("does not guess when two non-zero numbers disagree and either could be the wrong one", () => {
    const r = repairSide({ totalAssociates: 1862033, wounded: 766, dead: 170, alive: 1859097, casualtiesReduced: 291033, losses: 291969 });
    expect(r.changes).toEqual([]);
    expect(r.consistent).toBe(false);
  });
  it("ignores a side that was not read at all", () => {
    expect(repairSide({ totalAssociates: 0, wounded: 0, dead: 0, alive: 0, casualtiesReduced: 0, losses: 0 }).consistent).toBe(true);
  });
});

describe("parseBattleReport repairs a model's reading (the Gemini reply for a real screenshot)", () => {
  // What the model returned: Dead read as 64, and the defender's Alive left at 0.
  const reply = JSON.stringify({
    result: "victory",
    timestamp: "11-08 22:49",
    location: { server: 1, x: 101, y: 201 },
    target: { name: "Police Station", level: 8 },
    attacker: { formation: "Hitman - Square", totalAssociates: 1738596, wounded: 1303, dead: 64, alive: 1736429, casualtiesReduced: 214911, losses: 217078, influence: -64284 },
    defender: { formation: "Bruiser - Square", totalAssociates: 2500000, wounded: 0, dead: 1600638, alive: 0, casualtiesReduced: 0, losses: 1600638, influence: -57698738 },
    confidence: "low",
    notes: "Attacker's 'Dead' count (64) differs from the sum of losses.",
  });
  it("corrects both numbers and says so", () => {
    const b = parseBattleReport(reply);
    expect(b.attacker.dead).toBe(864);
    expect(b.defender.alive).toBe(899362);
    expect(b.notes).toMatch(/Corrected your side/);
    expect(b.notes).toMatch(/Corrected the defender/);
  });
  it("drops the model's own worry about the numbers we repaired, and lifts its 'low' confidence", () => {
    const b = parseBattleReport(reply);
    expect(b.notes).not.toMatch(/differs from the sum/);
    expect(b.confidence).toBe("medium");
  });
  it("makes the real losses right: wounded + dead is 2,167, not 1,367", () => {
    const b = parseBattleReport(reply);
    expect(b.attacker.wounded + b.attacker.dead).toBe(2167);
  });
});
