import {
  effectiveLossRatio,
  pairBattles,
  recordTime,
  leadTroop,
  type BattleRecord,
  type HistoryRecord,
  type Pair,
} from "./history";
import { buffEdge } from "./insights";
import type { CombatReport } from "./schema";
import { computeStrategy, TROOP_LABEL, type StrategyConfig, type TroopType } from "./strategy";

/** A win only counts as a good precedent if real losses (wounded + dead) stay under this share of the army. */
export const DEFAULT_LOSS_CAP = 0.1;
/** Past defenses must be at least this similar (troop mix) to the target to be shown. */
export const MIN_MIX_SIMILARITY = 0.6;

const TROOPS: TroopType[] = ["bruisers", "hitmen", "bikers", "mortars"];

/** One past battle that was a win with acceptable losses. */
export interface Precedent {
  id: string;
  when: number;
  /** 0..1, how closely that defense resembled the target. */
  score: number;
  formation: string | null;
  lead: TroopType | null;
  ourAssociates: number;
  theirAssociates: number;
  /** Our associates divided by theirs. */
  forceRatio: number;
  lossRatio: number;
  /** Crew ATK buff points, attacker minus defender; null when no buff screen was logged. */
  buffEdge: number | null;
  /** Led with the troop type the matchup chart favours against that defense. */
  onChart: boolean;
  /** The troop type the chart favoured against that defense (null when it had no troops). */
  chartLead: TroopType | null;
}

export interface Playbook {
  precedents: Precedent[];
  /** Counts against past defenses with the same main troop type as the target. */
  family: { goodWins: number; costlyWins: number; defeats: number };
  /** Smallest force ratio that produced a good win against that kind of defense. */
  minRatioOnChart: number | null;
  minRatioOffChart: number | null;
}

function mixSimilarity(a: CombatReport, b: CombatReport): number {
  const sa = computeStrategy(a).shares;
  const sb = computeStrategy(b).shares;
  const dist = TROOPS.reduce((s, t) => s + Math.abs(sa[t] - sb[t]), 0) / 2;
  return 1 - dist;
}

function sizeSimilarity(a: number, b: number): number {
  return a && b ? Math.min(a, b) / Math.max(a, b) : 0;
}

export function buildPlaybook(
  target: CombatReport,
  pairs: Pair[],
  cfg: StrategyConfig,
  lossCap = DEFAULT_LOSS_CAP,
): Playbook {
  const dom = computeStrategy(target, cfg).dominant;
  const out: Playbook = {
    precedents: [],
    family: { goodWins: 0, costlyWins: 0, defeats: 0 },
    minRatioOnChart: null,
    minRatioOffChart: null,
  };
  if (!dom) return out;

  for (const { battle, recon } of pairs) {
    if (!recon) continue;
    const b = battle.report;
    const rs = computeStrategy(recon.report, cfg);
    const lossRatio = effectiveLossRatio(b);
    const win = b.result === "victory";
    const good = win && lossRatio <= lossCap;
    const lead = leadTroop(b, cfg.formations, battle.ledWith);
    const theirs = b.defender.totalAssociates || recon.report.associates.total;
    const forceRatio = theirs ? b.attacker.totalAssociates / theirs : 0;
    const chartLead = rs.dominant ? cfg.counters[rs.dominant] : null;
    const onChart = lead !== null && lead === chartLead;

    if (rs.dominant === dom) {
      if (good) out.family.goodWins++;
      else if (win) out.family.costlyWins++;
      else if (b.result === "defeat") out.family.defeats++;
      if (good && forceRatio > 0) {
        const key = onChart ? "minRatioOnChart" : "minRatioOffChart";
        out[key] = out[key] === null ? forceRatio : Math.min(out[key]!, forceRatio);
      }
    }

    const mix = mixSimilarity(target, recon.report);
    if (good && mix >= MIN_MIX_SIMILARITY) {
      const lvlT = target.building?.level;
      const lvlR = recon.report.building?.level;
      const score =
        0.6 * mix +
        0.3 * sizeSimilarity(target.associates.total, recon.report.associates.total) +
        0.1 * (lvlT != null && lvlT === lvlR ? 1 : 0);
      out.precedents.push({
        id: battle.id,
        when: recordTime(battle),
        score,
        formation: b.attacker.formation ?? null,
        lead,
        ourAssociates: b.attacker.totalAssociates,
        theirAssociates: theirs,
        forceRatio,
        lossRatio,
        buffEdge: buffEdge(b),
        onChart,
        chartLead,
      });
    }
  }
  out.precedents.sort((a, b) => b.score - a.score || a.lossRatio - b.lossRatio || b.when - a.when);
  return out;
}

/** Associates needed to repeat a precedent against this target. */
export function armyNeeded(p: Precedent, targetAssociates: number): number {
  return Math.round(p.forceRatio * targetAssociates);
}

/** One-line feedback after a battle is saved: what the app learned from it. */
export function learningSummary(
  battle: BattleRecord,
  records: HistoryRecord[],
  cfg: StrategyConfig,
  lossCap = DEFAULT_LOSS_CAP,
): string {
  const pair = pairBattles(records).find((p) => p.battle.id === battle.id);
  if (!pair?.recon) {
    return "Saved. No usable recon of these coordinates is in History, so this battle cannot teach the playbook. A usable recon is of the same coordinates, made before this battle and after any earlier attack on that target. Analyze it (any time) and they pair automatically.";
  }
  const b = battle.report;
  const loss = effectiveLossRatio(b);
  const theirs = b.defender.totalAssociates || pair.recon.report.associates.total;
  const ratio = theirs ? b.attacker.totalAssociates / theirs : 0;
  const dom = computeStrategy(pair.recon.report, cfg).dominant;
  const enemy = dom ? `${TROOP_LABEL[dom]}-heavy defense` : "defense";
  const what = `${b.attacker.formation ?? "unknown formation"}, ${b.attacker.totalAssociates.toLocaleString("en-US")} vs ${theirs.toLocaleString("en-US")} (${ratio.toFixed(2)}x), real losses ${(loss * 100).toFixed(2)}%`;
  if (b.result === "victory" && loss <= lossCap) {
    return `Learned: a good win against a ${enemy} (${what}). Added to your playbook.`;
  }
  if (b.result === "victory") {
    return `Recorded a costly win against a ${enemy} (${what}); losses are above your ${(lossCap * 100).toFixed(0)}% cap, so it is not used as a precedent.`;
  }
  if (b.result === "defeat") {
    return `Recorded a defeat against a ${enemy} (${what}). It is counted in the playbook totals for similar defenses.`;
  }
  return `Saved (${what}).`;
}
