import { leadTroop, effectiveLossRatio, type BattleRecord, type Pair } from "./history";
import type { BattleReport } from "./schema";
import { computeStrategy, TROOP_LABEL, type StrategyConfig, type TroopType } from "./strategy";

/** Battles needed with one (enemy, our lead) combination before a conclusion is drawn. */
export const MIN_BATTLES = 5;
/** Defense must be at least this share one troop type to count as a test of a single counter rule. */
export const MIN_DOMINANT_SHARE = 0.5;
/** Crew ATK buff points by which the attacker may lead before the win is discounted. */
export const BUFF_EDGE_LIMIT = 200;

export interface Tally {
  n: number;
  wins: number;
  winRate: number;
  avgOurLoss: number;
}

export type InsightStatus = "supported" | "questionable" | "off-triangle" | "need-data";

export interface RuleInsight {
  enemy: TroopType;
  ruleCounter: TroopType;
  status: InsightStatus;
  message: string;
}

export interface Skipped {
  noRecon: number;
  mixedDefense: number;
  unknownFormation: number;
  buffAdvantaged: number;
}

export interface RuleAnalysis {
  insights: RuleInsight[];
  usable: number;
  skipped: Skipped;
}

/** Attacker minus defender Crew ATK buff (percentage points); null when the report has no such row. */
export function buffEdge(b: BattleReport): number | null {
  const row = b.buffs.find((x) => /crew\s*atk/i.test(x.stat));
  if (!row || row.attacker == null || row.defender == null) return null;
  return row.attacker - row.defender;
}

function tally(battles: BattleReport[]): Tally {
  const n = battles.length;
  const wins = battles.filter((b) => b.result === "victory").length;
  return {
    n,
    wins,
    winRate: n ? wins / n : 0,
    avgOurLoss: n ? battles.reduce((s, b) => s + effectiveLossRatio(b), 0) / n : 0,
  };
}

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const L = (t: TroopType) => TROOP_LABEL[t];
const desc = (t: Tally) => `${t.wins}/${t.n} won, avg real losses ${pct(t.avgOurLoss, 2)}`;

/** Compares the counter rules with what actually happened in paired battles. */
export function analyzeRules(pairs: Pair[], cfg: StrategyConfig): RuleAnalysis {
  const skipped: Skipped = { noRecon: 0, mixedDefense: 0, unknownFormation: 0, buffAdvantaged: 0 };
  // enemy type -> our lead type -> battles
  const evidence = new Map<TroopType, Map<TroopType, BattleReport[]>>();
  let usable = 0;

  for (const { battle, recon } of pairs) {
    if (!recon) {
      skipped.noRecon++;
      continue;
    }
    const s = computeStrategy(recon.report, cfg);
    if (!s.dominant || s.dominant === "mortars" || s.shares[s.dominant] < MIN_DOMINANT_SHARE) {
      skipped.mixedDefense++;
      continue;
    }
    const ours = leadTroop(battle.report, cfg.formations, battle.ledWith);
    if (!ours) {
      skipped.unknownFormation++;
      continue;
    }
    const edge = buffEdge(battle.report);
    if (edge !== null && edge > BUFF_EDGE_LIMIT) {
      skipped.buffAdvantaged++;
      continue;
    }
    usable++;
    const byOurs = evidence.get(s.dominant) ?? new Map<TroopType, BattleReport[]>();
    byOurs.set(ours, [...(byOurs.get(ours) ?? []), battle.report]);
    evidence.set(s.dominant, byOurs);
  }

  const insights: RuleInsight[] = [];
  for (const [enemy, byOurs] of evidence) {
    const rule = cfg.counters[enemy];
    const followed = tally(byOurs.get(rule) ?? []);
    const alts = [...byOurs.entries()]
      .filter(([t]) => t !== rule)
      .map(([t, bs]) => ({ t, ...tally(bs) }))
      .filter((a) => a.n >= MIN_BATTLES)
      .sort((a, b) => b.winRate - a.winRate || a.avgOurLoss - b.avgOurLoss);
    const best = alts[0];

    let insight: RuleInsight;
    if (best && best.winRate >= 0.8 && best.winRate >= followed.winRate + 0.2) {
      // The matchup chart is a game rule, so this is never offered as a rule change.
      insight = {
        enemy,
        ruleCounter: rule,
        status: "off-triangle",
        message:
          `You won ${best.wins}/${best.n} against ${L(enemy)}-heavy defenses leading with ${L(best.t)}, ` +
          `although the game's chart favours ${L(rule)}. That is most likely your buffs or troop numbers, not the troop type, ` +
          `so the app keeps recommending ${L(rule)}.`,
      };
    } else if (followed.n >= MIN_BATTLES && followed.winRate >= 0.8) {
      insight = {
        enemy,
        ruleCounter: rule,
        status: "supported",
        message: `Rule holds: ${L(rule)} vs ${L(enemy)}-heavy defenses, ${desc(followed)}.`,
      };
    } else if (followed.n >= MIN_BATTLES && followed.winRate < 0.5) {
      insight = {
        enemy,
        ruleCounter: rule,
        status: "questionable",
        message: `Rule doubtful: ${L(rule)} vs ${L(enemy)}-heavy defenses, ${desc(followed)}. Check your buffs and formations, or try another counter.`,
      };
    } else {
      const total = [...byOurs.values()].reduce((s, bs) => s + bs.length, 0);
      insight = {
        enemy,
        ruleCounter: rule,
        status: "need-data",
        message:
          `${L(enemy)}-heavy defenses: ${total} usable ${total === 1 ? "battle" : "battles"}, ` +
          `${followed.n} with the rule's ${L(rule)}` +
          (followed.n ? ` (${desc(followed)})` : "") +
          `. Need ${MIN_BATTLES} per combination to judge.`,
      };
    }
    insights.push(insight);
  }
  const order: Record<InsightStatus, number> = { questionable: 0, "off-triangle": 1, supported: 2, "need-data": 3 };
  insights.sort((a, b) => order[a.status] - order[b.status]);
  return { insights, usable, skipped };
}

// ---------------------------------------------------------------------------
// Solo limits, from battles the user labelled as solo attacks.
// ---------------------------------------------------------------------------

export type LimitKey = "soloMaxTraps" | "soloMaxAssociates" | "soloMaxWall";

export interface ThresholdInsight {
  key: LimitKey;
  label: string;
  current: number;
  suggested: number;
  message: string;
}

const METRICS: { key: LimitKey; label: string; value: (b: BattleReport) => number }[] = [
  { key: "soloMaxTraps", label: "traps", value: (b) => b.traps.total },
  { key: "soloMaxAssociates", label: "associates", value: (b) => b.defender.totalAssociates },
  { key: "soloMaxWall", label: "wall durability", value: (b) => b.wallDurability },
];

/** Two significant digits, so suggestions read like "125,000" not "124,995". */
function nice(v: number, dir: "up" | "down"): number {
  if (v <= 0) return 0;
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  return (dir === "up" ? Math.ceil(v / step) : Math.floor(v / step)) * step;
}

export function analyzeThresholds(
  battles: BattleRecord[],
  cfg: StrategyConfig,
): { insights: ThresholdInsight[]; solo: number } {
  const solos = battles.filter((b) => b.attackType === "solo");
  const insights: ThresholdInsight[] = [];
  for (const m of METRICS) {
    const current = cfg.thresholds[m.key];
    const wins = solos.filter((b) => b.report.result === "victory").map((b) => m.value(b.report));
    const losses = solos.filter((b) => b.report.result === "defeat").map((b) => m.value(b.report));
    const maxWin = wins.length ? Math.max(...wins) : 0;
    const minLoss = losses.length ? Math.min(...losses) : Infinity;
    if (maxWin > current && maxWin < minLoss) {
      const suggested = nice(maxWin, "up");
      insights.push({
        key: m.key,
        label: m.label,
        current,
        suggested,
        message: `You won a solo attack against ${maxWin.toLocaleString("en-US")} ${m.label}; the solo limit is ${current.toLocaleString("en-US")}.`,
      });
    } else if (minLoss < current && minLoss > maxWin) {
      const suggested = nice(minLoss * 0.9, "down");
      insights.push({
        key: m.key,
        label: m.label,
        current,
        suggested,
        message: `You lost a solo attack against only ${minLoss.toLocaleString("en-US")} ${m.label}; the solo limit is ${current.toLocaleString("en-US")}.`,
      });
    }
  }
  return { insights, solo: solos.length };
}
