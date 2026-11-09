import { describe, expect, it } from "vitest";
import { parseCombatReport } from "./schema";
import { computeStrategy, formatChatMessage } from "./strategy";

const mix = (m: Partial<Record<"bruisers" | "hitmen" | "bikers" | "mortars", number>>) =>
  parseCombatReport(
    JSON.stringify({
      wallDurability: { current: 1, max: 1 },
      traps: { lacerator: 0, pineappleGrenade: 0, napalmBomb: 0, total: 0 },
      associates: { bruisers: 0, hitmen: 0, bikers: 0, mortars: 0, ...m, total: 0 },
    }),
  );

// Values from the 20:41 recon screenshot.
const reply = `Here you go:
\`\`\`json
{"reportType":"recon","location":{"server":1,"x":102,"y":202},
 "building":{"name":"Police Station","level":8},
 "enforcers":{"count":5,"names":[]},
 "wallDurability":{"current":"2,500,000","max":2500000},
 "traps":{"lacerator":21080,"pineappleGrenade":21650,"napalmBomb":82270,"total":125000},
 "associates":{"bruisers":421600,"hitmen":1645400,"bikers":433000,"mortars":0,"total":2500000},
 "confidence":"high","notes":null}
\`\`\``;

describe("parseCombatReport", () => {
  it("extracts fenced JSON and coerces comma strings", () => {
    const r = parseCombatReport(reply);
    expect(r.wallDurability.current).toBe(2_500_000);
    expect(r.associates.hitmen).toBe(1_645_400);
  });
  it("rejects replies with no JSON", () => {
    expect(() => parseCombatReport("sorry")).toThrow();
  });
});

describe("computeStrategy", () => {
  it("counters a hitmen-heavy defense with bruisers and demands a rally", () => {
    const s = computeStrategy(parseCombatReport(reply));
    expect(s.dominant).toBe("hitmen");
    expect(s.composition).toEqual({ bruisers: 100 }); // 66% Hitmen = majority -> full counter
    expect(Object.values(s.composition).reduce((a, b) => a + (b ?? 0), 0)).toBe(100);
    expect(s.verdict).not.toBe("solo-ok");
    expect(s.dominantTrap?.name).toBe("Napalm Bomb");
    expect(formatChatMessage(parseCombatReport(reply), s)).toContain("Police Station");
  });
});

describe("safeguards on the recommended mix", () => {
  it("majority Bruisers -> 100% Bikers (minorities do not dilute it)", () => {
    const s = computeStrategy(mix({ bruisers: 1_921_000, bikers: 110_200, hitmen: 468_800 }));
    expect(s.composition).toEqual({ bikers: 100 });
    expect(s.formation).toMatch(/Biker|Hitman/); // formation comes from the lead type
    expect(s.notes[0]).toMatch(/majority/i);
  });
  it("majority Bikers -> 100% Hitmen", () => {
    expect(computeStrategy(mix({ bikers: 2_081_600, bruisers: 322_900, hitmen: 95_500 })).composition).toEqual({
      hitmen: 100,
    });
  });
  it("no majority -> blends counters but ignores types under 15%", () => {
    const s = computeStrategy(mix({ bruisers: 450, hitmen: 400, bikers: 150 - 1 }));
    // bikers = 14.9% of the field -> ignored; remaining 52.9/47.1 split between Bikers and Bruisers
    expect(Object.keys(s.composition).sort()).toEqual(["bikers", "bruisers"]);
    expect(s.notes[0]).toMatch(/Ignored as too small/);
    expect(Object.values(s.composition).reduce((a, b) => a + (b ?? 0), 0)).toBe(100);
  });
  it("mortars never change the mix", () => {
    const withMortars = computeStrategy(mix({ bruisers: 600, mortars: 5000 }));
    expect(withMortars.composition).toEqual({ bikers: 100 });
    expect(withMortars.notes.join(" ")).toMatch(/Mortar Cars/);
    expect(computeStrategy(mix({ mortars: 100 })).composition).toEqual({});
  });
});
