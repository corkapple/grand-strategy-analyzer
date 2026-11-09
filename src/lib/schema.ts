import { z } from "zod";

/** Accepts 1234, "1,234", "1 234", null/undefined (-> 0). */
const count = z
  .preprocess(
    (v) => (typeof v === "string" ? Number(v.replace(/[,\s]/g, "")) : v),
    z.number().nonnegative().nullish(),
  )
  .transform((v) => v ?? 0);

const optInt = z.number().nullable().optional();

export const CombatReportSchema = z.object({
  reportType: z.enum(["recon", "victory", "defeat", "unknown"]).default("unknown"),
  /** Mail date/time exactly as printed, e.g. "11-08 21:13". */
  timestamp: z.string().nullable().optional(),
  location: z
    .object({ server: optInt, x: optInt, y: optInt })
    .nullable()
    .optional(),
  building: z
    .object({ name: z.string().nullable().optional(), level: optInt })
    .nullable()
    .optional(),
  enforcers: z
    .object({ count: count, names: z.array(z.string()).optional() })
    .default({ count: 0 }),
  wallDurability: z.preprocess(
    (v) => {
      // "2,500,000/2,500,000" or a bare number instead of {current, max}
      if (typeof v === "number") return { current: v, max: v };
      if (typeof v === "string") {
        const [cur, max] = v.split("/");
        return { current: cur, max: max ?? cur };
      }
      return v;
    },
    z.object({ current: count, max: count }),
  ),
  traps: z.object({
    lacerator: count,
    pineappleGrenade: count,
    napalmBomb: count,
    total: count,
  }),
  associates: z.object({
    bruisers: count,
    hitmen: count,
    bikers: count,
    mortars: count,
    total: count,
  }),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  notes: z.string().nullable().optional(),
});

export type CombatReport = z.output<typeof CombatReportSchema>;

export class ReportParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
    /** False for deliberate content errors (wrong screenshot type), where another model would not help. */
    public readonly retryable = true,
    /** Set when the reply shows the screenshots are of the other type; the UI switches and retries. */
    public readonly suggestKind?: "recon" | "battle",
  ) {
    super(message);
    this.name = "ReportParseError";
  }
}

const stripReasoning = (t: string) => t.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, " ");

/** Top-level `{...}` blocks in `src`, string-aware. Unbalanced openers are skipped. */
function topLevelObjects(src: string, max = 30): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length && out.length < max) {
    const start = src.indexOf("{", i);
    if (start < 0) break;
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let j = start; j < src.length; j++) {
      const c = src[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) {
      i = start + 1; // unbalanced opener (e.g. "{" in prose): try the next one
    } else {
      out.push(src.slice(start, end + 1));
      i = end + 1;
    }
  }
  return out;
}

/** Models often leave trailing commas; remove them. */
const repairJson = (s: string) => s.replace(/,\s*([}\]])/g, "$1");

/**
 * Finds the first top-level JSON object in a model reply that actually parses. Handles ``` fences,
 * <think> blocks, prose around the JSON, stray braces and trailing commas.
 */
export function extractJson(text: string): string {
  const clean = stripReasoning(text);
  const fenced = [...clean.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  for (const src of [...fenced, clean]) {
    for (const cand of topLevelObjects(src)) {
      for (const attempt of [cand, repairJson(cand)]) {
        try {
          JSON.parse(attempt);
          return attempt;
        } catch {
          // try the repaired form, then the next candidate
        }
      }
    }
  }
  throw new ReportParseError("No valid JSON object found in the reply.", text);
}

/** Which kind of report a model reply is shaped like, judging by its top-level keys. */
function looksLike(json: unknown): "recon" | "battle" | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.attacker || o.defender || o.reportType === "victory" || o.reportType === "defeat") return "battle";
  if (o.reportType === "recon" || o.associates || o.traps) return "recon";
  return null;
}

/** Parse + validate, then fill in totals the model left at 0 and flag mismatches. */
export function parseCombatReport(text: string): CombatReport {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (e) {
    if (e instanceof ReportParseError) throw e;
    throw new ReportParseError(`Invalid JSON: ${(e as Error).message}`, text);
  }
  const parsed = CombatReportSchema.safeParse(json);
  if (!parsed.success) {
    if (looksLike(json) === "battle") {
      throw new ReportParseError('This looks like a victory/defeat mail. Switch "Screenshot type" to Battle result.', text, false, "battle");
    }
    throw new ReportParseError(
      `Reply did not match the schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      text,
    );
  }
  const r = parsed.data;
  const trapSum = r.traps.lacerator + r.traps.pineappleGrenade + r.traps.napalmBomb;
  const assocSum =
    r.associates.bruisers + r.associates.hitmen + r.associates.bikers + r.associates.mortars;
  if (!r.wallDurability.max) r.wallDurability.max = r.wallDurability.current;
  if (!r.traps.total) r.traps.total = trapSum;
  if (!r.associates.total) r.associates.total = assocSum;

  if (!r.associates.total && !r.traps.total) {
    throw new ReportParseError(
      r.reportType === "victory" || r.reportType === "defeat"
        ? 'This looks like a victory/defeat mail. Switch "Screenshot type" to Battle result.'
        : "No defense numbers (associates or traps) were found. Is this a recon report screenshot?",
      text,
      false,
      r.reportType === "victory" || r.reportType === "defeat" ? "battle" : undefined,
    );
  }
  if (r.reportType === "victory" || r.reportType === "defeat") {
    throw new ReportParseError('This looks like a victory/defeat mail. Switch "Screenshot type" to Battle result.', text, false, "battle");
  }

  const warn: string[] = [];
  // Screenshots can show totals that differ slightly from the visible rows (e.g. 124,995 vs 124,995±).
  if (trapSum && Math.abs(trapSum - r.traps.total) > Math.max(10, r.traps.total * 0.01))
    warn.push(`Trap rows (${trapSum}) differ from total (${r.traps.total}).`);
  if (assocSum && Math.abs(assocSum - r.associates.total) > Math.max(10, r.associates.total * 0.01))
    warn.push(`Associate rows (${assocSum}) differ from total (${r.associates.total}).`);
  if (warn.length) {
    r.confidence = "low";
    r.notes = [r.notes, ...warn].filter(Boolean).join(" ");
  }
  return r;
}

// ---------------------------------------------------------------------------
// Battle result (Victory / Defeat mail: Crew Details + Buff Comparison screens)
// ---------------------------------------------------------------------------

/** Signed number; accepts "-22,568,577", "−5", "-" (-> 0). */
const signed = z
  .preprocess(
    (v) => (typeof v === "string" ? Number(v.replace(/[,\s]/g, "").replace("−", "-") || 0) : v),
    z.number().nullish(),
  )
  .transform((v) => v ?? 0);

/** Percent like "+325.3%" or "+1200.0%" -> 325.3 / 1200. */
const pct = z.preprocess(
  (v) => (typeof v === "string" ? Number(v.replace(/[%,\s+]/g, "")) : v),
  z.number().nullish(),
);

/** Troops by type, from the Battle Details screen (all tiers added together). */
const troopMix = z
  .object({ bruisers: count, hitmen: count, bikers: count, mortars: count })
  .nullish();

const battleSide = z.object({
  formation: z.string().nullish(),
  /** What the side actually fielded. Formation names do not say: Bikers use "Hitman - Square". */
  troops: troopMix,
  totalAssociates: count,
  wounded: count,
  dead: count,
  alive: count,
  /** "Casualties Reduced": losses the game saved; included in the headline "Losses" figure. */
  casualtiesReduced: count,
  losses: count,
  influence: signed,
});

export const BattleReportSchema = z.object({
  result: z.enum(["victory", "defeat", "unknown"]).default("unknown"),
  timestamp: z.string().nullable().optional(),
  location: z.object({ server: optInt, x: optInt, y: optInt }).nullable().optional(),
  target: z
    .object({ name: z.string().nullable().optional(), level: optInt })
    .nullable()
    .optional(),
  attacker: battleSide,
  defender: battleSide,
  traps: z
    .object({
      total: count,
      requiresRepair: count,
      destroyed: count,
      remaining: count,
    })
    .default({ total: 0, requiresRepair: 0, destroyed: 0, remaining: 0 }),
  wallDurability: count,
  buffs: z
    .array(z.object({ stat: z.string(), attacker: pct, defender: pct }))
    .default([]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  notes: z.string().nullable().optional(),
});

export type BattleReport = z.output<typeof BattleReportSchema>;

import { repairSide } from "./identities";

export function parseBattleReport(text: string): BattleReport {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (e) {
    if (e instanceof ReportParseError) throw e;
    throw new ReportParseError(`Invalid JSON: ${(e as Error).message}`, text);
  }
  const parsed = BattleReportSchema.safeParse(json);
  if (!parsed.success) {
    if (looksLike(json) === "recon") {
      throw new ReportParseError('This looks like a recon report. Switch "Screenshot type" to Recon report.', text, false, "recon");
    }
    throw new ReportParseError(
      `Reply did not match the schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      text,
    );
  }
  const b = parsed.data;
  if (!b.attacker.totalAssociates && !b.defender.totalAssociates) {
    throw new ReportParseError(
      'No battle numbers were found. Is this a victory/defeat mail? For a recon report, switch "Screenshot type" to Recon report.',
      text,
      false,
      "recon",
    );
  }
  // Check the model's numbers against the game's own arithmetic and repair what the totals prove wrong.
  const notes: string[] = [];
  for (const who of ["attacker", "defender"] as const) {
    const r = repairSide(b[who]);
    if (r.changes.length) {
      b[who] = { ...b[who], ...r.side };
      notes.push(`Corrected ${who === "attacker" ? "your side" : "the defender"} using the game's totals: ${r.changes.join(", ")}.`);
    } else if (!r.consistent) {
      notes.push(`${who === "attacker" ? "Your side's" : "The defender's"} numbers do not add up; one of them may be misread.`);
    }
  }
  if (notes.length) b.notes = [b.notes, ...notes].filter(Boolean).join(" ");
  return b;
}

export interface AutoResult {
  recon: CombatReport | null;
  battle: BattleReport | null;
  /** A "Recon Failed" mail was among the screenshots. */
  reconFailed: boolean;
}

/**
 * Reads a reply to the combined prompt: { recon, battle, reconFailed }. Also accepts the older
 * single-report shapes, since some models ignore the wrapper.
 */
export function parseAuto(text: string): AutoResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (e) {
    if (e instanceof ReportParseError) throw e;
    throw new ReportParseError(`Invalid JSON: ${(e as Error).message}`, text);
  }
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const wrapped = "recon" in o || "battle" in o || "reconFailed" in o;
  if (!wrapped) {
    // Single report in the old shape.
    return looksLike(json) === "battle"
      ? { recon: null, battle: parseBattleReport(text), reconFailed: false }
      : { recon: parseCombatReport(text), battle: null, reconFailed: false };
  }
  const present = (v: unknown) => !!v && typeof v === "object";
  let recon: CombatReport | null = null;
  let battle: BattleReport | null = null;
  const problems: string[] = [];
  if (present(o.recon)) {
    try {
      recon = parseCombatReport(JSON.stringify(o.recon));
    } catch (e) {
      problems.push(`recon: ${(e as Error).message}`);
    }
  }
  if (present(o.battle)) {
    try {
      battle = parseBattleReport(JSON.stringify(o.battle));
    } catch (e) {
      problems.push(`battle: ${(e as Error).message}`);
    }
  }
  const reconFailed = o.reconFailed === true;
  if (!recon && !battle && !reconFailed) {
    throw new ReportParseError(
      problems.length ? `Could not read the screenshots (${problems.join("; ")}).` : "No recon report or battle result was found in the screenshots.",
      text,
      problems.length > 0,
    );
  }
  return { recon, battle, reconFailed };
}
