import { effectiveLossRatio, enemyLossRatio, leadInfo, recommendedLead, type Pair } from "./history";
import type { BattleReport, CombatReport } from "./schema";
import { computeStrategy, TROOP_LABEL, verdictText, type StrategyConfig } from "./strategy";

export interface Rematch {
  /** True when the attack was lost. */
  lost: boolean;
  headline: string;
  lines: string[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * What to do differently (or the same) against the enemy a battle faced: the counter, the formation, and whether
 * the matchup or the numbers decided it. `recon` may be a real recon or the enemy mix read from Battle Details.
 */
/**
 * How big an army your own counter-matched wins needed, as a share of the enemy's army: the smallest such win with
 * acceptable losses. Null when there is no such win yet.
 */
export function smallestCounterWin(pairs: Pair[], cfg: StrategyConfig, lossCap: number): { ratio: number; n: number } | null {
  let min = Infinity;
  let n = 0;
  for (const { battle, recon } of pairs) {
    const rb = battle.report;
    if (rb.result !== "victory" || !recon) continue;
    const dom = computeStrategy(recon.report, cfg).dominant;
    const counter = dom ? cfg.counters[dom] : null;
    if (!counter || leadInfo(rb, cfg.formations).lead !== counter) continue;
    if (effectiveLossRatio(rb) > lossCap) continue;
    const theirs = rb.defender.totalAssociates || recon.report.associates.total;
    if (!theirs || !rb.attacker.totalAssociates) continue;
    min = Math.min(min, rb.attacker.totalAssociates / theirs);
    n++;
  }
  return n ? { ratio: min, n } : null;
}

export function rematchAdvice(
  b: BattleReport,
  recon: CombatReport,
  cfg: StrategyConfig,
  history?: { pairs: Pair[]; lossCap: number },
): Rematch {
  const s = computeStrategy(recon, cfg);
  const { lead, source } = leadInfo(b, cfg.formations);
  const known = source === "troops"; // only say what you led with when it was actually read from the troop rows
  const want = recommendedLead(recon, cfg);
  const lost = b.result === "defeat";
  const theirs = b.defender.totalAssociates || recon.associates.total;
  const ratio = theirs ? b.attacker.totalAssociates / theirs : 0;
  const send = Object.entries(s.composition)
    .map(([k, v]) => `${v}% ${TROOP_LABEL[k as keyof typeof TROOP_LABEL]}`)
    .join(" + ");
  const lines: string[] = [];

  if (s.dominant) lines.push(`The enemy was mostly ${TROOP_LABEL[s.dominant]} (${pct(s.shares[s.dominant])}).`);
  if (known && lead && want && lead !== want) {
    lines.push(`You led with ${TROOP_LABEL[lead]}, but the counter to that is ${TROOP_LABEL[want]}.`);
  } else if (known && lead && want) {
    lines.push(`${TROOP_LABEL[lead]} was the right lead against that.`);
  } else if (want) {
    lines.push(`The troops you sent could not be read from Battle Details, so check you led with ${TROOP_LABEL[want]}.`);
  }
  if (send) lines.push(`Send ${send}${s.formation ? ` in ${s.formation}` : ""}.`);
  if (ratio) lines.push(`You had ${ratio.toFixed(2)}x their army and killed ${pct(enemyLossRatio(b))} of it.`);
  if (lost && known && lead && want && lead === want) {
    lines.push("The matchup was right, so it came down to numbers: bring more associates, or call a rally.");
  }
  // A concrete army size, from the smallest of your own wins that used the right counter.
  const win = history ? smallestCounterWin(history.pairs, cfg, history.lossCap) : null;
  if (win && theirs) {
    const need = Math.ceil((win.ratio * theirs) / 10_000) * 10_000;
    const fewer = ratio && ratio < win.ratio * 0.98;
    lines.push(
      `Your ${win.n} counter-matched win${win.n > 1 ? "s" : ""} so far used at least ${win.ratio.toFixed(2)}x the enemy's army, about ${need.toLocaleString("en-US")} associates against this one.` +
        (fewer ? ` You sent ${b.attacker.totalAssociates.toLocaleString("en-US")}, so bring about ${(need - b.attacker.totalAssociates).toLocaleString("en-US")} more.` : ""),
    );
  }
  lines.push(verdictText(s.verdict));

  return {
    lost,
    headline: lost ? "You lost this fight. Here is how to win it next time:" : "Next attack on a target like this:",
    lines,
  };
}
