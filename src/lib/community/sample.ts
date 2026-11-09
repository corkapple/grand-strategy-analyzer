import { effectiveLossRatio, enemyLossRatio, leadTroop, trapsDestroyedRatio, type Pair } from "../history";
import { buffEdge } from "../insights";
import { DEFAULT_STRATEGY, FORMATION_NAMES, type TroopType } from "../strategy";

/**
 * What the app shares: numbers only. No player or alliance names, no coordinates, no server, no
 * screenshots, no exact times. Rounded so a sample cannot be traced back to one specific battle.
 */
export interface Sample {
  v: 1;
  app: string;
  /** UTC date the sample was sent. */
  day: string;
  result: "victory" | "defeat";
  level: number | null;
  /** Defender troop mix in whole percent. */
  enemy: { bruisers: number; hitmen: number; bikers: number; mortars: number };
  /** Defender army, rounded to the nearest 50,000. */
  enemyTotal: number;
  formation: string | null;
  /** The troop type the attack was led with (a formation name alone does not say). */
  lead: "bruisers" | "hitmen" | "bikers" | null;
  /** Our army, rounded to the nearest 50,000. */
  ours: number;
  /** Our army divided by theirs, 1 decimal. */
  ratio: number;
  /** Our wounded + dead as a share of our army, 3 decimals. */
  ourLoss: number;
  enemyLoss: number;
  trapsDestroyed: number | null;
  /** Our Crew ATK buff minus theirs, to the nearest 25 points. */
  buffEdge: number | null;
  attackType: "solo" | "rally" | null;
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const dp = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Builds a sample from a battle paired with its recon; null when there is nothing useful to share. */
export function buildSample(
  pair: Pair,
  appVersion: string,
  now = new Date(),
  formations: Record<TroopType, string> = DEFAULT_STRATEGY.formations,
): Sample | null {
  const { battle, recon } = pair;
  const b = battle.report;
  if (!recon || (b.result !== "victory" && b.result !== "defeat")) return null;
  const a = recon.report.associates;
  const total = a.bruisers + a.hitmen + a.bikers + a.mortars;
  if (!total || !b.attacker.totalAssociates) return null;
  const pct = (v: number) => Math.round((v / total) * 100);
  const enemyTotal = Math.max(50_000, round(recon.report.associates.total || total, 50_000));
  const ours = Math.max(50_000, round(b.attacker.totalAssociates, 50_000));
  const edge = buffEdge(b);
  const formation = b.attacker.formation && (FORMATION_NAMES as readonly string[]).includes(b.attacker.formation) ? b.attacker.formation : null;
  return {
    v: 1,
    app: appVersion,
    day: now.toISOString().slice(0, 10),
    result: b.result,
    level: b.target?.level && b.target.level >= 1 && b.target.level <= 60 ? b.target.level : null,
    enemy: { bruisers: pct(a.bruisers), hitmen: pct(a.hitmen), bikers: pct(a.bikers), mortars: pct(a.mortars) },
    enemyTotal: Math.min(enemyTotal, 20_000_000),
    formation,
    lead: ((l) => (l === "mortars" ? null : l))(leadTroop(b, formations)),
    ours: Math.min(ours, 20_000_000),
    ratio: Math.min(20, dp(b.attacker.totalAssociates / (recon.report.associates.total || total), 1)),
    ourLoss: Math.min(1, dp(effectiveLossRatio(b), 3)),
    enemyLoss: Math.min(1, dp(enemyLossRatio(b), 2)),
    trapsDestroyed: b.traps.total ? Math.min(1, dp(trapsDestroyedRatio(b), 2)) : null,
    buffEdge: edge == null ? null : Math.max(-3000, Math.min(3000, round(edge, 25))),
    attackType: battle.attackType ?? null,
  };
}
