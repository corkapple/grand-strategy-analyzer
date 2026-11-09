import Dashboard from "@/components/Dashboard";
import { pairBattles } from "@/lib/history";
import { rematchAdvice } from "@/lib/rematch";
import type { BattleReport, CombatReport } from "@/lib/schema";
import { log } from "@/lib/log";
import { TROOP_LABEL, type StrategyConfig, type TroopType } from "@/lib/strategy";
import { useHistory } from "@/store/history";
import { useSettings } from "@/store/settings";
import { useEffect, useMemo } from "react";

/**
 * After a battle: what to send next time against the enemy it faced. For a defeat this is the way to win it.
 * Without any idea of the enemy's mix the only safe advice is the default: a full Bikers raid.
 */
export default function RematchPanel({
  battle,
  enemy,
  config,
  ledWith,
  showEnemy = true,
}: {
  battle: BattleReport;
  enemy: CombatReport | null;
  config: StrategyConfig;
  ledWith?: TroopType;
  /** False when the enemy's own dashboard is already on screen. */
  showEnemy?: boolean;
}) {
  const records = useHistory((s) => s.records);
  const lossCap = useSettings((s) => s.lossCap);
  const pairs = useMemo(() => pairBattles(records), [records]);
  const advice = useMemo(
    () => (enemy ? rematchAdvice(battle, enemy, config, { pairs, lossCap }, ledWith) : null),
    [battle, enemy, config, pairs, lossCap, ledWith],
  );
  // Written to the diagnostic log so the advice can be checked without a screenshot.
  useEffect(() => {
    if (advice) log("rematch.advice", { lost: advice.lost, lines: advice.lines });
  }, [advice]);
  if (!enemy) {
    const lost = battle.result === "defeat";
    return (
      <section className="card space-y-1 border-amber-500/60 text-sm">
        <h2 className="font-semibold text-amber-400">{lost ? "You lost this fight." : "Next attack on this target:"}</h2>
        <p className="text-zinc-300">
          The app does not know what the enemy had, because there is no recon and no readable Battle Details screen. Without that
          the default is a <b>full 100% {TROOP_LABEL.bikers} raid</b>, formation {config.formations.bikers}. Do a recon first, or
          send the battle together with its Battle Details screen, and the app can name the real counter.
        </p>
      </section>
    );
  }
  if (!advice) return null;
  return (
    <div className="space-y-3">
      <section className={`card space-y-1 text-sm ${advice.lost ? "border-red-500/60" : "border-green-500/60"}`}>
        <h2 className={`font-semibold ${advice.lost ? "text-red-400" : "text-green-400"}`}>{advice.headline}</h2>
        <ul className="list-disc space-y-0.5 pl-5 text-zinc-200">
          {advice.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
      {showEnemy && <Dashboard report={enemy} config={config} />}
    </div>
  );
}
