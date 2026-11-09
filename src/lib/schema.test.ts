import { describe, expect, it } from "vitest";
import { extractJson, parseBattleReport, parseCombatReport, ReportParseError } from "./schema";

const recon = {
  reportType: "recon",
  wallDurability: { current: "2,500,000", max: 2500000 },
  traps: { lacerator: 1, pineappleGrenade: 2, napalmBomb: 3, total: 6 },
  associates: { bruisers: 10, hitmen: 20, bikers: 30, mortars: 0, total: 60 },
};

describe("extractJson", () => {
  it("skips <think> reasoning that contains braces", () => {
    const t = `<think>maybe {"a":1} is it? let me check {</think>\n${JSON.stringify({ ok: true })}`;
    expect(JSON.parse(extractJson(t))).toEqual({ ok: true });
  });
  it("finds the JSON after prose with stray braces", () => {
    const t = `Sure! Here {is} the data { :\n${JSON.stringify({ ok: 1 })}\nHope that helps.`;
    expect(JSON.parse(extractJson(t))).toEqual({ ok: 1 });
  });
  it("repairs trailing commas", () => {
    expect(JSON.parse(extractJson('```json\n{"a": [1, 2,], "b": {"c": 3,},}\n```'))).toEqual({ a: [1, 2], b: { c: 3 } });
  });
  it("uses a later fenced block when the first one is not JSON", () => {
    const t = "```text\nnot json\n```\n```json\n{\"x\": 5}\n```";
    expect(JSON.parse(extractJson(t))).toEqual({ x: 5 });
  });
  it("returns the outer object, not a nested one", () => {
    expect(JSON.parse(extractJson('{"outer":{"inner":1}}'))).toEqual({ outer: { inner: 1 } });
  });
  it("keeps braces inside strings intact", () => {
    expect(JSON.parse(extractJson('{"note":"a } b { c"}'))).toEqual({ note: "a } b { c" });
  });
  it("throws a ReportParseError when there is no valid JSON", () => {
    expect(() => extractJson("nothing here")).toThrow(ReportParseError);
    expect(() => extractJson("{ not: valid json }")).toThrow(ReportParseError);
  });
});

describe("parseCombatReport robustness", () => {
  it("accepts wall durability as 'current/max' text or a bare number", () => {
    const a = parseCombatReport(JSON.stringify({ ...recon, wallDurability: "2,500,000/2,500,000" }));
    expect(a.wallDurability).toEqual({ current: 2_500_000, max: 2_500_000 });
    const b = parseCombatReport(JSON.stringify({ ...recon, wallDurability: 1_000 }));
    expect(b.wallDurability).toEqual({ current: 1000, max: 1000 });
  });
  it("fills a missing wall max from current", () => {
    const r = parseCombatReport(JSON.stringify({ ...recon, wallDurability: { current: 500 } }));
    expect(r.wallDurability.max).toBe(500);
  });
  it("tells the user when a battle mail was analyzed as a recon", () => {
    expect(() => parseCombatReport(JSON.stringify({ ...recon, reportType: "victory" }))).toThrow(/Battle result/);
  });
  it("rejects an empty extraction instead of saving garbage", () => {
    const empty = { ...recon, traps: { lacerator: 0, pineappleGrenade: 0, napalmBomb: 0, total: 0 }, associates: { bruisers: 0, hitmen: 0, bikers: 0, mortars: 0, total: 0 } };
    expect(() => parseCombatReport(JSON.stringify(empty))).toThrow(/No defense numbers/);
  });
  it("flags row sums that disagree with totals as low confidence", () => {
    const r = parseCombatReport(JSON.stringify({ ...recon, associates: { ...recon.associates, total: 600 } }));
    expect(r.confidence).toBe("low");
    expect(r.notes).toMatch(/differ/);
  });
});

describe("parseBattleReport robustness", () => {
  it("tells the user when a recon was analyzed as a battle", () => {
    const empty = { result: "unknown", attacker: {}, defender: {} };
    expect(() => parseBattleReport(JSON.stringify(empty))).toThrow(/Recon report/);
  });
  it("accepts a normal battle with string numbers", () => {
    const r = parseBattleReport(
      JSON.stringify({
        result: "victory",
        attacker: { totalAssociates: "1,862,033", wounded: "1,766", dead: "1,170", influence: "-105,696" },
        defender: { totalAssociates: "2,250,000", dead: "1,390,204", influence: "-50,268,754" },
      }),
    );
    expect(r.attacker.totalAssociates).toBe(1_862_033);
    expect(r.defender.influence).toBe(-50_268_754);
  });
});

describe("wrong screenshot type", () => {
  const kindOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as ReportParseError).suggestKind;
    }
  };
  it("tells the UI to switch to battle when a recon prompt got a victory mail", () => {
    // Real case: a web chat answered the recon prompt for a victory mail, in a hybrid shape.
    const hybrid = JSON.stringify({ ...recon, reportType: "victory" });
    expect(kindOf(() => parseCombatReport(hybrid))).toBe("battle");
    const battleShaped = JSON.stringify({ result: "victory", attacker: { formation: "x" }, defender: {} });
    expect(kindOf(() => parseCombatReport(battleShaped))).toBe("battle");
  });
  it("tells the UI to switch to recon when a battle prompt got a recon report", () => {
    expect(kindOf(() => parseBattleReport(JSON.stringify(recon)))).toBe("recon");
  });
});

describe("parseAuto (one drop for recon + battle)", () => {
  const battleJson = {
    result: "victory",
    timestamp: "11-08 21:46",
    location: { server: 1, x: 103, y: 203 },
    target: { name: "Police Station", level: 8 },
    attacker: { formation: "Hitman - Square", totalAssociates: 2359550, wounded: 1409, dead: 934, alive: 2357207, casualtiesReduced: 232283, losses: 234626, influence: -84348 },
    defender: { formation: "Bruiser - Square", totalAssociates: 2500000, wounded: 0, dead: 2024637, alive: 475363, casualtiesReduced: 0, losses: 2024637, influence: -72887602 },
  };
  it("reads a recon and a battle from one reply", async () => {
    const { parseAuto } = await import("./schema");
    const r = parseAuto(JSON.stringify({ recon, battle: battleJson, reconFailed: false }));
    expect(r.recon?.associates.total).toBe(60);
    expect(r.battle?.result).toBe("victory");
  });
  it("handles a failed recon with only a battle", async () => {
    const { parseAuto } = await import("./schema");
    const r = parseAuto(JSON.stringify({ recon: null, battle: battleJson, reconFailed: true }));
    expect(r.recon).toBeNull();
    expect(r.reconFailed).toBe(true);
    expect(r.battle?.attacker.dead).toBe(934);
  });
  it("accepts an old single-report reply", async () => {
    const { parseAuto } = await import("./schema");
    expect(parseAuto(JSON.stringify(recon)).recon).not.toBeNull();
    expect(parseAuto(JSON.stringify(battleJson)).battle).not.toBeNull();
  });
  it("rejects replies with nothing usable", async () => {
    const { parseAuto } = await import("./schema");
    expect(() => parseAuto(JSON.stringify({ recon: null, battle: null, reconFailed: false }))).toThrow(/No recon/);
    expect(() => parseAuto("Recon Failed: the defender used an Anti-Recon item.")).toThrow();
  });
});
