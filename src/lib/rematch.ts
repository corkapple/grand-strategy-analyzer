import { enemyLossRatio, leadTroop, recommendedLead } from "./history";
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
export function rematchAdvice(b: BattleReport, recon: CombatReport, cfg: StrategyConfig): Rematch {
  const s = computeStrategy(recon, cfg);
  const lead = leadTroop(b, cfg.formations);
  const want = recommendedLead(recon, cfg);
  const lost = b.result === "defeat";
  const theirs = b.defender.totalAssociates || recon.associates.total;
  const ratio = theirs ? b.attacker.totalAssociates / theirs : 0;
  const send = Object.entries(s.composition)
    .map(([k, v]) => `${v}% ${TROOP_LABEL[k as keyof typeof TROOP_LABEL]}`)
    .join(" + ");
  const lines: string[] = [];

  if (s.dominant) lines.push(`The enemy was mostly ${TROOP_LABEL[s.dominant]} (${pct(s.shares[s.dominant])}).`);
  if (lead && want && lead !== want) {
    lines.push(`You led with ${TROOP_LABEL[lead]}, but the counter to that is ${TROOP_LABEL[want]}.`);
  } else if (lead && want) {
    lines.push(`${TROOP_LABEL[lead]} was the right lead against that.`);
  }
  if (send) lines.push(`Send ${send}${s.formation ? ` in ${s.formation}` : ""}.`);
  if (ratio) lines.push(`You had ${ratio.toFixed(2)}x their army and killed ${pct(enemyLossRatio(b))} of it.`);
  if (lost && lead && want && lead === want) {
    lines.push("The matchup was right, so it came down to numbers: bring more associates, or call a rally.");
  }
  lines.push(verdictText(s.verdict));

  return {
    lost,
    headline: lost ? "You lost this fight. Here is how to win it next time:" : "Next attack on a target like this:",
    lines,
  };
}
