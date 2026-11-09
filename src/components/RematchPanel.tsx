import Dashboard from "@/components/Dashboard";
import { rematchAdvice } from "@/lib/rematch";
import type { BattleReport, CombatReport } from "@/lib/schema";
import { TROOP_LABEL, type StrategyConfig } from "@/lib/strategy";

/**
 * After a battle: what to send next time against the enemy it faced. For a defeat this is the way to win it.
 * Without any idea of the enemy's mix the only safe advice is the default: a full Bikers raid.
 */
export default function RematchPanel({ battle, enemy, config }: { battle: BattleReport; enemy: CombatReport | null; config: StrategyConfig }) {
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
  const advice = rematchAdvice(battle, enemy, config);
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
      <Dashboard report={enemy} config={config} />
    </div>
  );
}
