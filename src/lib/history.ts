import type { BattleReport, CombatReport } from "./schema";
import { computeStrategy, DEFAULT_STRATEGY, type TroopType } from "./strategy";

export interface BaseRecord {
  id: string;
  /** Epoch ms when the analysis was saved. */
  createdAt: number;
  /** Small JPEG data URLs of the source screenshots. */
  thumbs: string[];
  provider?: string;
  model?: string;
}
export interface ReconRecord extends BaseRecord {
  kind: "recon";
  report: CombatReport;
  /**
   * Not a real recon: built from a battle's Battle Details screen (the defender's troops) when no recon
   * exists. Never stored; created on the fly by pairBattles.
   */
  synthetic?: boolean;
}
export interface BattleRecord extends BaseRecord {
  kind: "battle";
  report: BattleReport;
  /** Set by the user; the report itself does not say whether it was a rally. */
  attackType?: "solo" | "rally";
  /** Set by the user when the troop rows could not be read: what the attack was led with. */
  ledWith?: TroopType;
}
export type HistoryRecord = ReconRecord | BattleRecord;

/**
 * Game mails show "MM-DD HH:mm" with no year. Resolve against `ref` (when the
 * record was saved); if that lands more than a day in the future, use last year.
 */
export function parseGameTime(s: string | null | undefined, ref: number): number | null {
  const m = s?.match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [mo, d, h, mi] = m.slice(1).map(Number);
  const year = new Date(ref).getFullYear();
  let t = new Date(year, mo - 1, d, h, mi).getTime();
  if (t > ref + 864e5) t = new Date(year - 1, mo - 1, d, h, mi).getTime();
  return t;
}

export function recordTime(r: HistoryRecord): number {
  return parseGameTime(r.report.timestamp, r.createdAt) ?? r.createdAt;
}

export function troopFromFormation(f: string | null | undefined): TroopType | null {
  if (!f) return null;
  if (/bruiser/i.test(f)) return "bruisers";
  if (/hitm[ae]n/i.test(f)) return "hitmen";
  if (/biker/i.test(f)) return "bikers";
  if (/mortar/i.test(f)) return "mortars";
  return null;
}

const TROOPS: TroopType[] = ["bruisers", "hitmen", "bikers", "mortars"];
const baseName = (f: string) => f.split("(")[0].trim().toLowerCase();

/**
 * The troop type an attack was led with. A formation name does not tell: the game's "Hitman - Square"
 * is what Bikers use, so the name is only a fallback. Order: the troops actually fielded (Battle
 * Details), then the formation that the app's own advice pairs with exactly one troop type, then
 * unambiguous names (Biker..., Bruiser...), otherwise unknown.
 */
export interface LeadInfo {
  lead: TroopType | null;
  /**
   * "troops": read from the troop rows of Battle Details (reliable). "formation": a guess from the formation name
   * (can be wrong: the same formation is used with different troops). "none": not known.
   */
  source: "you" | "troops" | "formation" | "none";
}

export function leadInfo(
  b: BattleReport,
  formations: Record<TroopType, string> = DEFAULT_STRATEGY.formations,
  /** What the user said they led with: it beats anything read or guessed. */
  override?: TroopType,
): LeadInfo {
  if (override) return { lead: override, source: "you" };
  const t = b.attacker.troops;
  if (t) {
    // Models sometimes copy the defender's column into ours. Only trust troops that add up to our army.
    const sum = TROOPS.reduce((s, k) => s + (t[k] ?? 0), 0);
    const total = b.attacker.totalAssociates;
    const plausible = sum > 0 && (total <= 0 || (sum >= total * 0.85 && sum <= total * 1.15));
    const top = TROOPS.map((k) => [k, t[k] ?? 0] as const).sort((x, y) => y[1] - x[1])[0];
    if (plausible && top && top[1] > 0) return { lead: top[0], source: "troops" };
  }
  const f = b.attacker.formation;
  if (!f) return { lead: null, source: "none" };
  const name = baseName(f);
  const matches = TROOPS.filter((k) => baseName(formations[k]) === name);
  if (matches.length === 1) return { lead: matches[0], source: "formation" };
  if (matches.length > 1) return { lead: null, source: "none" };
  if (name.startsWith("biker")) return { lead: "bikers", source: "formation" };
  if (name.startsWith("bruiser")) return { lead: "bruisers", source: "formation" };
  return { lead: null, source: "none" };
}

/** The lead troop, from the best available evidence (see `leadInfo` for how reliable it is). */
export function leadTroop(
  b: BattleReport,
  formations: Record<TroopType, string> = DEFAULT_STRATEGY.formations,
  override?: TroopType,
): TroopType | null {
  return leadInfo(b, formations, override).lead;
}

/**
 * Real losses. The headline "Losses" figure includes "Casualties Reduced"
 * (casualties the game prevented), so wounded + dead is what actually hurt.
 */
export function effectiveLosses(b: BattleReport): number {
  return b.attacker.wounded + b.attacker.dead;
}
export function effectiveLossRatio(b: BattleReport): number {
  return b.attacker.totalAssociates ? effectiveLosses(b) / b.attacker.totalAssociates : 0;
}
export function enemyLossRatio(b: BattleReport): number {
  return b.defender.totalAssociates ? b.defender.dead / b.defender.totalAssociates : 0;
}
export function trapsDestroyedRatio(b: BattleReport): number {
  return b.traps.total ? b.traps.destroyed / b.traps.total : 0;
}

type Loc = { server?: number | null; x?: number | null; y?: number | null } | null | undefined;
function sameTarget(a: Loc, b: Loc): boolean {
  if (a?.x == null || a?.y == null || b?.x == null || b?.y == null) return false;
  if (a.x !== b.x || a.y !== b.y) return false;
  return a.server == null || b.server == null || a.server === b.server;
}

/**
 * Identifies one real event (this battle, this recon) so analysing the same screenshots again updates the
 * record instead of adding a second copy. Null when there is not enough to tell (no time or no coordinates).
 */
export function fingerprint(r: HistoryRecord): string | null {
  const loc = r.report.location;
  if (!r.report.timestamp || loc?.x == null || loc?.y == null) return null;
  const where = `${loc.server ?? ""}:${loc.x},${loc.y}`;
  return r.kind === "battle"
    ? `b|${r.report.timestamp}|${where}|${r.report.attacker.totalAssociates}|${r.report.defender.totalAssociates}`
    : `r|${r.report.timestamp}|${where}|${r.report.associates.total}`;
}

/**
 * The enemy's mix as a recon, built from the defender's troops on the Battle Details screen. This is what
 * lets a battle with no recon still count. Only used when the troops add up to roughly the defender's
 * army, so a misread screen does not invent an enemy.
 */
export function syntheticRecon(battle: BattleRecord): ReconRecord | null {
  const b = battle.report;
  const t = b.defender.troops;
  if (!t) return null;
  const sum = (t.bruisers ?? 0) + (t.hitmen ?? 0) + (t.bikers ?? 0) + (t.mortars ?? 0);
  const total = b.defender.totalAssociates;
  if (sum <= 0 || (total > 0 && (sum < total * 0.9 || sum > total * 1.1))) return null;
  return {
    id: `details:${battle.id}`,
    kind: "recon",
    synthetic: true,
    createdAt: battle.createdAt,
    thumbs: [],
    report: {
      reportType: "recon",
      timestamp: b.timestamp ?? null,
      location: b.location ?? null,
      building: { name: b.target?.name ?? null, level: b.target?.level ?? null },
      enforcers: { count: 0, names: [] },
      wallDurability: { current: b.wallDurability, max: b.wallDurability },
      traps: { lacerator: 0, pineappleGrenade: 0, napalmBomb: 0, total: b.traps.total },
      associates: { bruisers: t.bruisers ?? 0, hitmen: t.hitmen ?? 0, bikers: t.bikers ?? 0, mortars: t.mortars ?? 0, total: sum },
      confidence: b.confidence,
      notes: "Enemy mix taken from the Battle Details screen (no recon).",
    },
  };
}

export interface Pair {
  battle: BattleRecord;
  /** Latest recon of the same coordinates taken at or before the battle. */
  recon: ReconRecord | null;
}

export function pairBattles(records: HistoryRecord[]): Pair[] {
  const recons = records.filter((r): r is ReconRecord => r.kind === "recon");
  const battles = records.filter((r): r is BattleRecord => r.kind === "battle");
  return battles
    .map((battle) => {
      const bt = recordTime(battle);
      // An earlier attack on the same target changes its defense, so a recon taken before that
      // attack no longer describes what this battle faced.
      const earlier = battles.filter(
        (o) => o.id !== battle.id && sameTarget(o.report.location, battle.report.location) && recordTime(o) < bt,
      );
      const recon =
        recons
          .filter(
            (r) =>
              sameTarget(r.report.location, battle.report.location) &&
              recordTime(r) <= bt &&
              !earlier.some((o) => recordTime(o) > recordTime(r)),
          )
          .sort((a, b) => recordTime(b) - recordTime(a))[0] ?? null;
      return { battle, recon: recon ?? syntheticRecon(battle) };
    })
    .sort((a, b) => recordTime(b.battle) - recordTime(a.battle));
}

export interface MatchupStat {
  enemy: TroopType;
  ours: TroopType | "unknown";
  n: number;
  wins: number;
  /** Mean effective loss ratio (wounded + dead) / our associates. */
  avgOurLoss: number;
  /** Mean share of the defender's associates killed. */
  avgEnemyLoss: number;
  /** Battles where we led with the troop type the rules recommend. */
  followedAdvice: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Groups paired battles by (enemy dominant type, our lead type). `recommend` is the rules' lead type. */
export function matchupStats(
  pairs: Pair[],
  recommend: (r: CombatReport) => TroopType | null,
  formations: Record<TroopType, string> = DEFAULT_STRATEGY.formations,
): MatchupStat[] {
  const groups = new Map<string, Pair[]>();
  for (const p of pairs) {
    if (!p.recon) continue;
    const enemy = computeStrategy(p.recon.report).dominant;
    if (!enemy) continue;
    const ours = leadTroop(p.battle.report, formations, p.battle.ledWith) ?? "unknown";
    const key = `${enemy}|${ours}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([key, ps]) => {
      const [enemy, ours] = key.split("|") as [TroopType, TroopType | "unknown"];
      return {
        enemy,
        ours,
        n: ps.length,
        wins: ps.filter((p) => p.battle.report.result === "victory").length,
        avgOurLoss: mean(ps.map((p) => effectiveLossRatio(p.battle.report))),
        avgEnemyLoss: mean(ps.map((p) => enemyLossRatio(p.battle.report))),
        followedAdvice: ps.filter((p) => recommend(p.recon!.report) === ours).length,
      };
    })
    .sort((a, b) => b.n - a.n);
}

/** The troop type the rules put the most weight on. */
export function recommendedLead(r: CombatReport, cfg?: Parameters<typeof computeStrategy>[1]): TroopType | null {
  const comp = computeStrategy(r, cfg).composition;
  const top = Object.entries(comp).sort((a, b) => b[1] - a[1])[0];
  return (top?.[0] as TroopType | undefined) ?? null;
}
