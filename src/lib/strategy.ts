import type { CombatReport } from "./schema";

export type TroopType = "bruisers" | "hitmen" | "bikers" | "mortars";

/** The six formations in the game's Formation screen. */
export const FORMATION_NAMES = [
  "Bruiser - Square",
  "Hitman - Square",
  "Biker - Square",
  "Bruiser - Wedge",
  "Hitman - Wedge",
  "Biker - Wedge",
] as const;

export const TROOP_LABEL: Record<TroopType, string> = {
  bruisers: "Bruisers",
  hitmen: "Hitmen",
  bikers: "Bikers",
  mortars: "Mortars",
};

/**
 * GAME RULES (not user settings).
 *
 * Counter triangle, confirmed by the in-game "Strengths & Weaknesses" chart:
 *   Bikers beat Bruisers, Bruisers beat Hitmen, Hitmen beat Bikers.
 *   All three types counter Mortar Cars, so Mortars never change which type to send.
 * `counters[enemy]` = what we send against it. The `mortars` entry is unused.
 * The community article (note.com/game_mafia "Formation Part 1") adds: a good matchup deals
 * +100% damage and takes 50% less.
 *
 * Guards on the recommended mix (see `guards`):
 *  - Majority: if one field type is >= majorityShare of the defense, send 100% of its counter.
 *    Blending in other types only dilutes the counter; the minority's damage is small.
 *  - No majority: counter every type with at least `ignoreBelow` share; ignore smaller ones.
 *
 * Formations are named after the troop type used ("Hitman - Wedge"). Defaults:
 *  - Hitmen: Hitman - Wedge (won logged battles); Bikers: Hitman - Square;
 *    Bruisers: Bruiser - Wedge (assault beats Biker - Square for gangster-only attacks, per the article).
 *  - Mortars: no guidance.
 */
export interface StrategyConfig {
  counters: Record<TroopType, TroopType>;
  formations: Record<TroopType, string>;
  thresholds: {
    soloMaxTraps: number;
    soloMaxAssociates: number;
    soloMaxWall: number;
    /** Multiple of any solo threshold at which a single rally is not enough. */
    heavyMultiplier: number;
  };
  /** Safeguards for the recommended mix. */
  guards?: { majorityShare: number; ignoreBelow: number };
}

export const DEFAULT_STRATEGY: StrategyConfig = {
  counters: {
    hitmen: "bruisers",
    bikers: "hitmen",
    bruisers: "bikers",
    mortars: "bikers",
  },
  // Keyed by the troop type we lead with (see the notes above).
  formations: {
    hitmen: "Hitman - Wedge",
    bikers: "Hitman - Square (shooters in front, bikers hit last)",
    bruisers: "Bruiser - Wedge (assault; avoid Biker - Square)",
    mortars: "No formation guidance for mortars yet",
  },
  thresholds: {
    soloMaxTraps: 30_000,
    soloMaxAssociates: 500_000,
    soloMaxWall: 500_000,
    heavyMultiplier: 3,
  },
  guards: { majorityShare: 0.5, ignoreBelow: 0.15 },
};

export type Verdict = "solo-ok" | "rally" | "heavy-rally";

export interface Strategy {
  shares: Record<TroopType, number>; // 0..1 of enemy associates (all four types)
  dominant: TroopType | null;
  /** Integer percentages summing to 100 (empty when there is nothing to counter). */
  composition: Partial<Record<TroopType, number>>;
  formation: string;
  verdict: Verdict;
  reasons: string[];
  dominantTrap: { name: string; share: number } | null;
  /** Plain-language explanation of how the mix was chosen. */
  notes: string[];
}

const TROOPS: TroopType[] = ["bruisers", "hitmen", "bikers", "mortars"];
/** Mortar Cars are countered by all three, so only these decide the mix. */
const FIELD: TroopType[] = ["bruisers", "hitmen", "bikers"];

/** Largest-remainder rounding so percentages always sum to exactly 100. */
function toPercentages(weights: Partial<Record<TroopType, number>>): Partial<Record<TroopType, number>> {
  const entries = Object.entries(weights) as [TroopType, number][];
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  if (sum <= 0) return {};
  const raw = entries.map(([k, w]) => ({ k, v: (w / sum) * 100 }));
  const floors = raw.map((r) => ({ ...r, f: Math.floor(r.v) }));
  let left = 100 - floors.reduce((s, r) => s + r.f, 0);
  floors.sort((a, b) => b.v - b.f - (a.v - a.f));
  for (const r of floors) if (left-- > 0) r.f++;
  const out: Partial<Record<TroopType, number>> = {};
  for (const r of floors) if (r.f > 0) out[r.k] = r.f;
  return out;
}

const pc = (v: number) => `${Math.round(v * 100)}%`;

export function computeStrategy(
  report: CombatReport,
  cfg: StrategyConfig = DEFAULT_STRATEGY,
): Strategy {
  const a = report.associates;
  const total = TROOPS.reduce((s, t) => s + a[t], 0);
  const shares = Object.fromEntries(
    TROOPS.map((t) => [t, total ? a[t] / total : 0]),
  ) as Record<TroopType, number>;

  const dominant = total
    ? TROOPS.reduce((best, t) => (a[t] > a[best] ? t : best), TROOPS[0])
    : null;

  const g = cfg.guards ?? DEFAULT_STRATEGY.guards!;
  const notes: string[] = [];
  let composition: Partial<Record<TroopType, number>> = {};

  const field = FIELD.reduce((s, t) => s + a[t], 0);
  if (field > 0) {
    const fs = Object.fromEntries(FIELD.map((t) => [t, a[t] / field])) as Record<TroopType, number>;
    const top = FIELD.reduce((best, t) => (fs[t] > fs[best] ? t : best), FIELD[0]);
    if (fs[top] >= g.majorityShare) {
      const counter = cfg.counters[top];
      composition = { [counter]: 100 };
      notes.push(
        `${TROOP_LABEL[top]} are the majority (${pc(fs[top])}): send 100% ${TROOP_LABEL[counter]}. ` +
          `The other types are the minority; the small losses they cause are acceptable, and mixing them in would only dilute the counter.`,
      );
    } else {
      const weights: Partial<Record<TroopType, number>> = {};
      for (const t of FIELD) {
        if (fs[t] >= g.ignoreBelow) {
          const c = cfg.counters[t];
          weights[c] = (weights[c] ?? 0) + fs[t];
        }
      }
      if (!Object.keys(weights).length) weights[cfg.counters[top]] = 1;
      composition = toPercentages(weights);
      const ignored = FIELD.filter((t) => fs[t] > 0 && fs[t] < g.ignoreBelow);
      notes.push(
        `No majority type, so the mix counters each major type in proportion.` +
          (ignored.length
            ? ` Ignored as too small: ${ignored.map((t) => `${TROOP_LABEL[t]} ${pc(fs[t])}`).join(", ")}.`
            : ""),
      );
    }
    if (a.mortars > 0) {
      notes.push("Mortar Cars are countered by all three troop types, so they do not change the mix.");
    }
  } else if (a.mortars > 0) {
    notes.push("Only Mortar Cars: any of the three troop types counters them. Send your strongest.");
  }

  const top = Object.entries(composition).sort((x, y) => y[1] - x[1])[0]?.[0] as
    | TroopType
    | undefined;
  const formation = top ? cfg.formations[top] : "n/a";

  const th = cfg.thresholds;
  const traps = report.traps.total;
  const wall = report.wallDurability.current;
  const assoc = report.associates.total || total;
  const reasons: string[] = [];
  let ratio = 0;
  const check = (label: string, val: number, max: number) => {
    if (val > max) reasons.push(`${label} ${val.toLocaleString("en-US")} > solo limit ${max.toLocaleString("en-US")}`);
    ratio = Math.max(ratio, val / max);
  };
  check("Traps", traps, th.soloMaxTraps);
  check("Associates", assoc, th.soloMaxAssociates);
  check("Wall", wall, th.soloMaxWall);

  const verdict: Verdict =
    ratio > th.heavyMultiplier ? "heavy-rally" : ratio > 1 ? "rally" : "solo-ok";

  const trapRows = [
    ["Lacerator", report.traps.lacerator],
    ["Pineapple Grenade", report.traps.pineappleGrenade],
    ["Napalm Bomb", report.traps.napalmBomb],
  ] as const;
  const trapSum = trapRows.reduce((s, [, n]) => s + n, 0);
  const topTrap = [...trapRows].sort((x, y) => y[1] - x[1])[0];
  const dominantTrap =
    trapSum > 0 ? { name: topTrap[0], share: topTrap[1] / trapSum } : null;

  return { shares, dominant, composition, formation, verdict, reasons, dominantTrap, notes };
}

const VERDICT_TEXT: Record<Verdict, string> = {
  "solo-ok": "Solo attack viable",
  rally: "RALLY recommended - do NOT solo",
  "heavy-rally": "HEAVY RALLY required - do NOT solo",
};

export function verdictText(v: Verdict): string {
  return VERDICT_TEXT[v];
}

/** Compact multi-line text for pasting into game / faction chat. */
export function formatChatMessage(report: CombatReport, s: Strategy): string {
  const loc = report.location;
  const where =
    loc?.x != null && loc?.y != null
      ? ` @ ${loc.server ? `S:${loc.server} ` : ""}X:${loc.x} Y:${loc.y}`
      : "";
  const name = report.building?.name
    ? `${report.building.level ? `Lv.${report.building.level} ` : ""}${report.building.name}`
    : "Target";
  const n = (v: number) => v.toLocaleString("en-US");
  const comp = Object.entries(s.composition)
    .sort((a, b) => b[1] - a[1])
    .map(([t, p]) => `${p}% ${TROOP_LABEL[t as TroopType]}`)
    .join(" / ");
  return [
    `${name}${where}`,
    `Wall ${n(report.wallDurability.current)} | Traps ${n(report.traps.total)} | Assoc ${n(report.associates.total)} | Enf ${report.enforcers.count}`,
    `Enemy: ${TROOPS.filter((t) => report.associates[t] > 0)
      .map((t) => `${TROOP_LABEL[t]} ${Math.round(s.shares[t] * 100)}%`)
      .join(", ")}`,
    `Send: ${comp || "n/a"} (${s.formation})`,
    verdictText(s.verdict),
  ].join("\n");
}
