import { afterEach, describe, expect, it } from "vitest";
import { setOcrEngine } from "./engine";
import * as fx from "./fixtures";
import { classify, numbers, parseBattleMail, parseBuffs, parseRecon } from "./parse";
import { readScreens } from "./read";
import { localReader } from "../providers/localReader";
import { screenshotChain } from "../analyze";
import { analyzeWithFallback } from "../providers/fallback";
import { parseAuto } from "../schema";
import type { ImageInput } from "../providers/types";

afterEach(() => setOcrEngine(null));

describe("numbers()", () => {
  const v = (s: string) => numbers(s).map((n) => n.value);
  it("reads separators the reader mixes up", () => {
    expect(v("2,500,000")).toEqual([2500000]);
    expect(v("2 038,861")).toEqual([2038861]);
    expect(v("2,024 637")).toEqual([2024637]);
    expect(v("-176,868")).toEqual([-176868]);
    expect(v("−72,887,602")).toEqual([-72887602]);
  });
  it("does not guess a number with a lost digit", () => {
    expect(v("433,00ł")).toEqual([null]);
    expect(v("1,390,20")).toEqual([null]);
  });
  it("flags a stray glyph glued to a complete number", () => {
    expect(numbers("622,087ł")[0]).toEqual({ value: 622087, suspect: true });
    expect(numbers("622,087")[0]).toEqual({ value: 622087, suspect: false });
  });
});

describe("classify()", () => {
  it("tells the report screens apart", () => {
    expect(classify(fx.recon5)).toBe("recon");
    expect(classify(fx.mail3)).toBe("mail");
    expect(classify(fx.buff6)).toBe("buff");
    expect(classify(fx.details20)).toBe("details");
    expect(classify(["Recon Failed!", "The target used an Anti-Recon item"])).toBe("reconFailed");
    expect(classify(["Grand Strategy Analyzer", "Settings"])).toBe("unknown");
  });
});

describe("parseRecon()", () => {
  it("reads a clean recon and checks it against the totals", () => {
    const r = parseRecon(fx.recon5);
    expect(r.verified).toBe(true);
    expect(r.associates).toEqual({ bruisers: 322900, hitmen: 95500, bikers: 2081600, mortars: 0, total: 2500000 });
    expect(r.traps).toEqual({ lacerator: 16145, pineappleGrenade: 104080, napalmBomb: 4775, total: 125000 });
    expect(r.wall).toEqual({ current: 2500000, max: 2500000 });
    expect(r.building).toEqual({ name: "Elite Police Station", level: 8 });
    expect(r.timestamp).toBe("11-08 21:13");
    expect(r.location).toEqual({ server: 1, x: 101, y: 201 });
  });
  it("repairs a number whose last digit the reader lost, using the total (433,00? is 433,000)", () => {
    const r = parseRecon(fx.recon1);
    expect(r.verified).toBe(true);
    expect(r.associates.bikers).toBe(433000);
    expect(r.associates.bruisers + r.associates.hitmen + r.associates.bikers).toBe(r.associates.total);
  });
  it("is not fully verified when the time is unreadable", () => {
    const r = parseRecon(fx.recon2);
    expect(r.timestamp).toBeNull();
    expect(r.verified).toBe(false);
    expect(r.associates.total).toBe(2499900);
  });
  it("does not trust troop numbers that disagree with the total", () => {
    const bad = fx.recon5.map((r) => r.replace("322,900", "322,901"));
    expect(parseRecon(bad).verified).toBe(false);
  });
});

describe("parseBattleMail()", () => {
  it("reads a victory mail and checks both sides' arithmetic", () => {
    const b = parseBattleMail(fx.mail3);
    expect(b.verified).toBe(true);
    expect(b.result).toBe("victory");
    expect(b.target).toEqual({ name: "Elite Police Station", level: 8 });
    expect(b.attacker).toMatchObject({ formation: "Hitman - Wedge", totalAssociates: 2044290, wounded: 2951, dead: 1962, alive: 2039377, casualtiesReduced: 486579, losses: 491492, influence: -176868 });
    expect(b.defender).toMatchObject({ formation: "Bruiser - Square", totalAssociates: 2500000, wounded: 0, dead: 622087, alive: 1877913, losses: 622087 });
    expect(b.traps).toEqual({ total: 125000, requiresRepair: 0, destroyed: 34689, remaining: 90311 });
  });
  it("ignores the (i) icon next to Casualties Reduced that the reader sees as a 1", () => {
    expect(parseBattleMail(fx.mail10).defender.casualtiesReduced).toBe(0);
  });
  it("reads a mail that has no trap or wall rows (a cropped screenshot)", () => {
    const b = parseBattleMail(fx.mail21);
    expect(b.verified).toBe(true);
    expect(b.attacker.dead).toBe(934);
    expect(b.defender.dead).toBe(2024637);
  });
  it("refuses a mail where a digit was misread, even though every number looks plausible", () => {
    // total 1,862,033 does not fit wounded 766 + dead 170 + alive 1,859,097
    const b = parseBattleMail(fx.mail10);
    expect(b.verified).toBe(false);
    expect(b.problems.join(" ")).toMatch(/your side/);
  });
  it("derives a value the reader dropped from the identities (alive = total - wounded - dead)", () => {
    const rows = fx.mail3.filter((r) => !/Alive/.test(r));
    const b = parseBattleMail(rows);
    expect(b.verified).toBe(true);
    expect(b.attacker.alive).toBe(2039377);
  });
});

describe("parseBuffs()", () => {
  it("reads buff rows including a clipped right-hand value", () => {
    const b = parseBuffs(fx.buff6);
    expect(b[0]).toEqual({ stat: "Crew ATK", attacker: 325.3, defender: 1200 });
    expect(b.find((x) => x.stat === "Hitman ATK")?.attacker).toBe(492.3);
  });
});

// ---- the whole pipeline with a fake reader ---------------------------------------------------------

const img = (name: string): ImageInput => ({ base64: name, mimeType: "image/jpeg", name });
const screens: Record<string, string[]> = { recon5: fx.recon5, mail3: fx.mail3, mail10: fx.mail10, buff6: fx.buff6, mail21: fx.mail21, recon2: fx.recon2, details20: fx.details20 };
/** A reader that returns the same text for both readings. */
const steady = () => setOcrEngine(async (i) => screens[i.base64]);
/** A reader whose second reading flips a digit in the coordinates, as real readers sometimes do. */
const flaky = () => setOcrEngine(async (i, scale) => (scale === 1 ? screens[i.base64] : screens[i.base64].map((r) => r.replace("X:101", "X:151"))));

describe("on-device reader", () => {
  it("reads a recon, a battle mail and a buff screen together and verifies them", async () => {
    steady();
    const r = await readScreens([img("recon5"), img("mail3"), img("buff6")]);
    expect(r.verified).toBe(true);
    expect(r.recon?.associates.total).toBe(2500000);
    expect(r.battle?.buffs.find((b) => b.stat === "Crew ATK")?.attacker).toBe(325.3);
    const parsed = parseAuto(JSON.stringify(r.payload));
    expect(parsed.recon?.associates.bikers).toBe(2081600);
    expect(parsed.battle?.attacker.dead).toBe(1962);
    expect(parsed.battle?.attacker.troops).toBeNull();
  });
  it("does not trust a value the two readings disagree on (a wrong coordinate no total could catch)", async () => {
    flaky();
    const r = await readScreens([img("recon5")]);
    expect(r.verified).toBe(false);
    await expect(localReader.analyze({ images: [img("recon5")], systemPrompt: "", userPrompt: "" }, { extra: { strict: "1" } })).rejects.toThrow(/not certain/);
  });
  it("still returns a best-effort reading when not strict, marked unverified", async () => {
    flaky();
    const res = await localReader.analyze({ images: [img("recon5")], systemPrompt: "", userPrompt: "" }, { extra: { strict: "0" } });
    expect(res.model).toMatch(/unverified/);
    expect(res.note).toMatch(/not fully verified/);
    expect(parseAuto(res.text).recon).not.toBeNull();
  });
  it("refuses screens it cannot read, and screens with a misread digit in strict mode", async () => {
    steady();
    await expect(localReader.analyze({ images: [img("details20")], systemPrompt: "", userPrompt: "" }, { extra: { strict: "1" } })).rejects.toThrow(/no recon report or battle/);
    await expect(localReader.analyze({ images: [img("mail10")], systemPrompt: "", userPrompt: "" }, { extra: { strict: "1" } })).rejects.toThrow(/not certain/);
  });
  it("reports a failed recon so the app can advise a full Bikers raid", async () => {
    setOcrEngine(async (i) => (i.base64 === "failed" ? ["Mail", "Recon Failed!", "The target used an Anti-Recon item"] : screens[i.base64]));
    const r = await readScreens([img("failed"), img("mail21")]);
    expect(r.reconFailed).toBe(true);
    expect(parseAuto(JSON.stringify(r.payload)).reconFailed).toBe(true);
  });
  it("only reads screenshots, never guide text", async () => {
    await expect(localReader.analyze({ images: [], systemPrompt: "", userPrompt: "" }, {})).rejects.toThrow(/only reads screenshots/);
  });
});

describe("where the on-device reader sits in the chain", () => {
  const ai = { id: "gemini" as const, config: { apiKey: "k" } };
  it("goes first (strict) and last (best effort) around the AI services", () => {
    const c = screenshotChain({ providerId: "gemini", config: ai.config, fallbacks: [{ id: "openrouter", config: { apiKey: "o" } }], localFirst: true });
    expect(c.map((x) => `${x.id}${x.config.extra?.strict ?? ""}`)).toEqual(["local1", "gemini", "openrouter", "local0"]);
  });
  it("is only the last resort when 'read on this computer first' is off", () => {
    const c = screenshotChain({ providerId: "gemini", config: ai.config, localFirst: false });
    expect(c.map((x) => x.id)).toEqual(["gemini", "local"]);
  });
  it("does not use the AI at all when the on-device reading is verified", async () => {
    steady();
    let aiCalls = 0;
    const chain = screenshotChain({ providerId: "gemini", config: ai.config, localFirst: true });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      aiCalls++;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    try {
      const res = await analyzeWithFallback(chain, { images: [img("recon5")], systemPrompt: "", userPrompt: "" });
      expect(res.providerId).toBe("local");
      expect(res.model).toMatch(/verified/);
      expect(aiCalls).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });
  it("hands over to the AI when the reading is not certain", async () => {
    steady();
    const chain = screenshotChain({ providerId: "gemini", config: ai.config, localFirst: true });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"from":"gemini"}' }] } }] }), { status: 200 })) as typeof fetch;
    try {
      const res = await analyzeWithFallback(chain, { images: [img("mail10")], systemPrompt: "", userPrompt: "" });
      expect(res.providerId).toBe("gemini");
      expect(res.note).toMatch(/not certain/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
