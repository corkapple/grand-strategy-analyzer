/**
 * Reads The Grand Mafia report screens from OCR text, with no AI. The layouts are fixed, so each
 * value is found by its label. The game's own totals then check (and repair) every number: a recon's
 * troop counts must add up to "Defensive Associates", and a battle's rows must satisfy
 * alive = total - wounded - dead and losses = wounded + dead + casualties reduced. A value is only
 * trusted when those checks pass; otherwise the caller falls back to an AI model.
 */

export type ScreenKind = "recon" | "reconFailed" | "mail" | "buff" | "details" | "unknown";

export interface Num {
  /** null when the digits could not be trusted (cut off or garbled). */
  value: number | null;
  /** The text around the number had stray characters, so double-check it. */
  suspect: boolean;
}

const MINUS = /[−–—]/g;
// Thousands groups may be separated by a comma, dot or (misread) space.
const NUM = /-?\d{1,3}(?:[,. ]\d{3})+|-?\d+/g;

/** All numbers in a piece of text, in order. */
export function numbers(text: string): Num[] {
  const s = text.replace(MINUS, "-");
  const out: Num[] = [];
  NUM.lastIndex = 0;
  for (let m = NUM.exec(s); m; m = NUM.exec(s)) {
    const rest = s.slice(m.index + m[0].length);
    if (/^[,.]\d{1,2}(?!\d)/.test(rest)) {
      // "433,00?" : a digit was lost at the edge. Do not guess.
      out.push({ value: null, suspect: true });
      NUM.lastIndex += rest.match(/^[,.]\d{1,2}/)![0].length;
      continue;
    }
    const digits = m[0].replace(/[^\d-]/g, "");
    out.push({ value: Number(digits), suspect: /^[^\s|/%\d,.\-+]/.test(rest) });
  }
  return out;
}

/** Splits a row around a label: what is left of it (attacker side) and right of it (defender side). */
function around(row: string, label: RegExp): { left: string; right: string } | null {
  const m = label.exec(row);
  if (!m) return null;
  return { left: row.slice(0, m.index), right: row.slice(m.index + m[0].length) };
}
const rowWith = (rows: string[], label: RegExp) => rows.find((r) => label.test(r));
const first = (s: string) => numbers(s)[0];
const last = (s: string) => {
  const ns = numbers(s);
  return ns[ns.length - 1];
};

export function classify(rows: string[]): ScreenKind {
  const t = rows.join("\n");
  if (/Recon\s+Failed|Anti-?\s*Recon/i.test(t)) return "reconFailed";
  if (/Recon\s+Successful/i.test(t)) return "recon";
  if (/Crew\s+Details/i.test(t) && /Formation/i.test(t)) return "mail";
  if (/Buff\s+Comparison/i.test(t) || (/Crew\s+ATK/i.test(t) && (t.match(/%/g) ?? []).length >= 4)) return "buff";
  if (/Battle\s+Details/i.test(t) && /Total\s+Kills/i.test(t)) return "details";
  return "unknown";
}

// ---- shared bits -----------------------------------------------------------

export function timestampOf(rows: string[]): string | null {
  for (const r of rows.slice(0, 6)) {
    const m = r.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?!\d)/);
    if (m) return `${m[1]}-${m[2]} ${m[3]}:${m[4]}`;
  }
  return null;
}

export function locationOf(rows: string[]): { server: number; x: number; y: number } | null {
  for (const r of rows.slice(0, 8)) {
    const m = r.match(/S\s*:\s*(\d+)\s*X\s*:\s*(\d+)\s*Y\s*:?\s*(\d+)/i);
    if (m) return { server: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
  }
  return null;
}

// ---- recon -------------------------------------------------------------------

export interface ReconRead {
  timestamp: string | null;
  location: ReturnType<typeof locationOf>;
  building: { name: string | null; level: number | null };
  enforcers: number;
  wall: { current: number; max: number } | null;
  traps: { lacerator: number; pineappleGrenade: number; napalmBomb: number; total: number };
  associates: { bruisers: number; hitmen: number; bikers: number; mortars: number; total: number };
  /** Every number was read and passed the totals check. */
  verified: boolean;
  problems: string[];
}

/** Resolves values that are null using `sum = parts`; returns false when the check cannot pass. */
function resolveSum(total: number | null, parts: (number | null)[]): { total: number | null; parts: (number | null)[]; ok: boolean } {
  const unknown = parts.filter((p) => p === null).length;
  const known = parts.reduce<number>((s, p) => s + (p ?? 0), 0);
  if (total !== null && unknown === 1) {
    const missing = total - known;
    if (missing < 0) return { total, parts, ok: false };
    return { total, parts: parts.map((p) => (p === null ? missing : p)), ok: true };
  }
  if (total === null && unknown === 0) return { total: known, parts, ok: true };
  return { total, parts, ok: total !== null && unknown === 0 && known === total };
}

export function parseRecon(rows: string[]): ReconRead {
  const problems: string[] = [];
  const timestamp = timestampOf(rows);
  const location = locationOf(rows);
  if (!timestamp) problems.push("timestamp not readable");
  if (!location) problems.push("coordinates not readable");

  // "Lv. 8 Police Station": a misread level digit (8 shows up as &) is mapped back.
  let level: number | null = null;
  let name: string | null = null;
  for (const r of rows.slice(0, 8)) {
    const m = r.match(/Lv\.?\s*([0-9&Bb]{1,2})\s+([A-Za-z][A-Za-z .'-]+)/);
    if (m) {
      level = Number(m[1].replace(/[&Bb]/g, "8")) || null;
      name = m[2].trim();
      break;
    }
  }

  const enforcersRow = rowWith(rows, /Enforcers\s*:/i);
  const enforcers = enforcersRow ? (first(enforcersRow.split(/Enforcers\s*:/i)[1] ?? "")?.value ?? 0) : 0;

  let wall: ReconRead["wall"] = null;
  const wallRow = rowWith(rows, /\d[\d,. ]*\s*\/\s*\d[\d,. ]*/);
  if (wallRow && /Wall/i.test(wallRow)) {
    const m = wallRow.match(/(\d[\d,. ]*\d)\s*\/\s*(\d[\d,. ]*\d)/);
    if (m) wall = { current: Number(m[1].replace(/\D/g, "")), max: Number(m[2].replace(/\D/g, "")) };
  }
  if (!wall) problems.push("wall durability not readable");

  const after = (label: RegExp, row = rowWith(rows, label)) => {
    if (!row) return undefined;
    const part = around(row, label)!;
    return first(part.right);
  };

  // Traps
  const trapsTotalRow = rowWith(rows, /Traps\s*:/i);
  const trapsTotal = trapsTotalRow ? (first(trapsTotalRow.split(/Traps\s*:/i)[1] ?? "")?.value ?? null) : null;
  const t = {
    lacerator: after(/Lacerator/i),
    pineappleGrenade: after(/Pineapple/i),
    napalmBomb: after(/Napalm/i),
  };
  const trapParts = [t.lacerator, t.pineappleGrenade, t.napalmBomb].map((n) => (n === undefined ? 0 : n.value));
  const tr = resolveSum(trapsTotal, trapParts);
  if (!tr.ok) problems.push("trap numbers do not add up to the trap total");

  // Associates
  const assocRow = rowWith(rows, /Defensive\s+Associates/i);
  const assocTotal = assocRow ? (first(around(assocRow, /Defensive\s+Associates/i)!.right)?.value ?? null) : null;
  const a = {
    bruisers: after(/Gorillas|Bruisers?/i),
    hitmen: after(/Deadeyes|Hitm[ae]n/i),
    bikers: after(/Hell\s+on\s+Wheels|Bikers?/i),
    mortars: after(/Mortars?/i),
  };
  const assocParts = [a.bruisers, a.hitmen, a.bikers, a.mortars].map((n) => (n === undefined ? 0 : n.value));
  const as = resolveSum(assocTotal, assocParts);
  if (!as.ok) problems.push("troop numbers do not add up to Defensive Associates");

  const verified = problems.length === 0 && tr.total !== null && as.total !== null;
  return {
    timestamp,
    location,
    building: { name, level },
    enforcers,
    wall,
    traps: {
      lacerator: tr.parts[0] ?? 0,
      pineappleGrenade: tr.parts[1] ?? 0,
      napalmBomb: tr.parts[2] ?? 0,
      total: tr.total ?? 0,
    },
    associates: {
      bruisers: as.parts[0] ?? 0,
      hitmen: as.parts[1] ?? 0,
      bikers: as.parts[2] ?? 0,
      mortars: as.parts[3] ?? 0,
      total: as.total ?? 0,
    },
    verified,
    problems,
  };
}

// ---- battle mail ----------------------------------------------------------------

interface Side {
  formation: string | null;
  totalAssociates: number;
  wounded: number;
  dead: number;
  alive: number;
  casualtiesReduced: number;
  losses: number;
  influence: number;
}

export interface BattleRead {
  result: "victory" | "defeat" | "unknown";
  timestamp: string | null;
  location: ReturnType<typeof locationOf>;
  target: { name: string | null; level: number | null };
  attacker: Side;
  defender: Side;
  traps: { total: number; requiresRepair: number; destroyed: number; remaining: number };
  wallDurability: number;
  verified: boolean;
  problems: string[];
}

const FORMATION = /(Bruiser|Hitman|Hitmen|Biker|Mortar)s?\s*-\s*(Square|Wedge)/i;
const normFormation = (s: string): string | null => {
  const m = s.match(FORMATION);
  if (!m) return null;
  const type = /hitm/i.test(m[1]) ? "Hitman" : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${type} - ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}`;
};

type N = number | null;
interface Raw {
  total: N;
  wounded: N;
  dead: N;
  alive: N;
  cr: N;
  losses: N;
}

/** Fills one unknown at a time using the two identities until nothing more can be solved. */
function solveSide(r: Raw): boolean {
  for (let i = 0; i < 4; i++) {
    const rel1 = [r.total, r.alive, r.wounded, r.dead]; // total = alive + wounded + dead
    if (rel1.filter((v) => v === null).length === 1) {
      if (r.total === null) r.total = r.alive! + r.wounded! + r.dead!;
      else if (r.alive === null) r.alive = r.total - r.wounded! - r.dead!;
      else if (r.wounded === null) r.wounded = r.total - r.alive - r.dead!;
      else r.dead = r.total - r.alive - r.wounded!;
    }
    const rel2 = [r.losses, r.wounded, r.dead, r.cr]; // losses = wounded + dead + casualties reduced
    if (rel2.filter((v) => v === null).length === 1) {
      if (r.losses === null) r.losses = r.wounded! + r.dead! + r.cr!;
      else if (r.wounded === null) r.wounded = r.losses - r.dead! - r.cr!;
      else if (r.dead === null) r.dead = r.losses - r.wounded - r.cr!;
      else r.cr = r.losses - r.wounded - r.dead;
    }
  }
  const vals = Object.values(r);
  if (vals.some((v) => v === null || v < 0)) return false;
  return r.total === r.alive! + r.wounded! + r.dead! && r.losses === r.wounded! + r.dead! + r.cr!;
}

export function parseBattleMail(rows: string[]): BattleRead {
  const problems: string[] = [];
  const text = rows.join("\n");
  const timestamp = timestampOf(rows);
  const location = locationOf(rows);
  if (!timestamp) problems.push("timestamp not readable");
  if (!location) problems.push("coordinates not readable");

  const result: BattleRead["result"] = /OFFENSIVE\s+VICTORY|Successfully\s+Defeated/i.test(text)
    ? "victory"
    : /DEFEAT|Failed/i.test(text)
      ? "defeat"
      : "unknown";
  if (result === "unknown") problems.push("could not tell victory from defeat");

  let level: number | null = null;
  let name: string | null = null;
  const title = rows.slice(0, 4).join(" ");
  const tm = title.match(/Lv\.?\s*([0-9&Bb]{1,2})\s+([A-Za-z][A-Za-z .'-]*?)\s*!/);
  if (tm) {
    level = Number(tm[1].replace(/[&Bb]/g, "8")) || null;
    name = tm[2].trim();
  }

  /** The value on one side of a label; `ignoreSmall` drops the stray "1" read from the (i) icon. */
  const cell = (label: RegExp, side: "left" | "right", ignoreSmall = false): { row: boolean; n: Num | undefined } => {
    const row = rowWith(rows, label);
    if (!row) return { row: false, n: undefined };
    const part = around(row, label)![side];
    const ns = numbers(part).filter((n) => !(ignoreSmall && n.value !== null && n.value >= 0 && n.value < 10));
    return { row: true, n: side === "left" ? ns[ns.length - 1] : ns[0] };
  };

  const rawFor = (side: "left" | "right"): { raw: Raw; influence: Num | undefined } => {
    const get = (label: RegExp, small = false, zeroIfRowOnly = false): N => {
      const c = cell(label, side, small);
      if (c.n) return c.n.value;
      return c.row && zeroIfRowOnly ? 0 : null;
    };
    return {
      raw: {
        total: get(/Total\s+Associates/i),
        wounded: get(/Wounded/i, false, true),
        dead: get(/\bDead\b/i),
        alive: get(/\bAlive\b/i),
        cr: get(/Casualties\s+Reduced/i, true, true),
        losses: (() => {
          const row = rows.find((r) => /\bLosses\b/i.test(r) && !/Total|Kills/i.test(r));
          if (!row) return null;
          const p = around(row, /\bLosses\b/i)![side];
          const n = side === "left" ? last(p) : first(p);
          return n ? n.value : null;
        })(),
      },
      influence: cell(/Influence/i, side).n,
    };
  };

  const att = rawFor("left");
  const def = rawFor("right");
  const attOk = solveSide(att.raw);
  const defOk = solveSide(def.raw);
  if (!attOk) problems.push("your side's numbers do not add up");
  if (!defOk) problems.push("the defender's numbers do not add up");

  const formRow = rowWith(rows, /Formation/i);
  const fp = formRow ? around(formRow, /Formation/i)! : null;
  const attForm = fp ? normFormation(fp.left) : null;
  const defForm = fp ? normFormation(fp.right) : null;
  if (!attForm) problems.push("your formation not readable");

  const infl = (n: Num | undefined) => (n && n.value !== null ? n.value : null);
  if (infl(att.influence) === null) problems.push("influence not readable");

  // Defender traps and wall
  const trapsTotal = (() => {
    const r = rowWith(rows, /Total\s+Traps/i);
    return r ? (first(around(r, /Total\s+Traps/i)?.right ?? r)?.value ?? null) : null;
  })();
  const val = (label: RegExp): N => {
    const r = rowWith(rows, label);
    if (!r) return null;
    const n = first(around(r, label)!.right);
    return n ? n.value : null;
  };
  const destroyed = val(/Destroyed/i);
  const remaining = val(/Remaining/i);
  const repair = val(/Requires\s+Repair/i) ?? 0;
  const wall = val(/Wall\s+Durability/i);
  const traps = {
    total: trapsTotal ?? (destroyed !== null && remaining !== null ? destroyed + remaining + repair : 0),
    requiresRepair: repair,
    destroyed: destroyed ?? 0,
    remaining: remaining ?? 0,
  };

  const verified = problems.length === 0;
  const side = (r: Raw, f: string | null, infValue: N): Side => ({
    formation: f,
    totalAssociates: r.total ?? 0,
    wounded: r.wounded ?? 0,
    dead: r.dead ?? 0,
    alive: r.alive ?? 0,
    casualtiesReduced: r.cr ?? 0,
    losses: r.losses ?? 0,
    influence: infValue ?? 0,
  });
  return {
    result,
    timestamp,
    location,
    target: { name, level },
    attacker: side(att.raw, attForm, infl(att.influence)),
    defender: side(def.raw, defForm, infl(def.influence)),
    traps,
    wallDurability: wall ?? 0,
    verified,
    problems,
  };
}

// ---- buff comparison ---------------------------------------------------------------

export interface Buff {
  stat: string;
  attacker: number;
  defender: number;
}

export function parseBuffs(rows: string[]): Buff[] {
  const out: Buff[] = [];
  for (const r of rows) {
    // "+325.3%  |  Crew ATK  |  +1200.0%": the right figure is sometimes clipped, so it is optional.
    const m = r.match(/([+-]?\d[\d,]*\.?\d*)\s*%\s*\|?\s*([A-Za-z][A-Za-z ]*?)\s*\|?\s*([+-]?\d[\d,]*\.?\d*)\s*%?/);
    if (!m) continue;
    const stat = m[2].trim().replace(/DEE\b/, "DEF");
    const a = Number(m[1].replace(/,/g, ""));
    const d = Number(m[3].replace(/,/g, ""));
    if (!Number.isFinite(a) || !Number.isFinite(d)) continue;
    out.push({ stat, attacker: a, defender: d });
  }
  return out;
}
