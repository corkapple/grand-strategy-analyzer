import { effectiveLosses, effectiveLossRatio, enemyLossRatio, trapsDestroyedRatio } from "@/lib/history";
import type { BattleReport } from "@/lib/schema";

const n = (v: number) => v.toLocaleString("en-US");
const p = (v: number) => `${(v * 100).toFixed(1)}%`;

function Line({ label, a, d }: { label: string; a: string | number; d: string | number }) {
  const f = (v: string | number) => (typeof v === "number" ? n(v) : v);
  return (
    <tr className="border-t border-border/50">
      <td className="py-1 pr-2 text-right tabular-nums">{f(a)}</td>
      <td className="px-2 text-center text-xs text-zinc-400">{label}</td>
      <td className="py-1 pl-2 tabular-nums">{f(d)}</td>
    </tr>
  );
}

export default function BattleDashboard({ report: b }: { report: BattleReport }) {
  const win = b.result === "victory";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card">
        <div
          className={`mb-3 rounded-md border px-3 py-2 font-semibold ${
            win ? "border-green-500 text-green-400" : "border-red-500 text-red-400"
          }`}
        >
          {b.result === "unknown" ? "Result unknown" : win ? "Victory" : "Defeat"}
          {b.target?.name && (
            <span className="ml-2 font-normal text-zinc-300">
              {b.target.level ? `Lv.${b.target.level} ` : ""}
              {b.target.name}
            </span>
          )}
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {b.timestamp ?? ""} · confidence: {b.confidence}
          </span>
        </div>
        {b.notes && <p className="mb-2 text-xs text-amber-400">{b.notes}</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-400">
              <th className="text-right font-medium">Attacker (you)</th>
              <th />
              <th className="text-left font-medium">Defender</th>
            </tr>
          </thead>
          <tbody>
            <Line label="Formation" a={b.attacker.formation ?? "-"} d={b.defender.formation ?? "-"} />
            <Line label="Associates" a={b.attacker.totalAssociates} d={b.defender.totalAssociates} />
            <Line label="Wounded" a={b.attacker.wounded} d={b.defender.wounded} />
            <Line label="Dead" a={b.attacker.dead} d={b.defender.dead} />
            <Line label="Alive" a={b.attacker.alive} d={b.defender.alive} />
            <Line label="Influence" a={b.attacker.influence} d={b.defender.influence} />
          </tbody>
        </table>
      </section>

      <section className="card space-y-2 text-sm">
        <h3 className="font-medium">Efficiency</h3>
        <div className="flex justify-between">
          <span className="text-zinc-400">Your real losses (wounded + dead)</span>
          <span>
            {n(effectiveLosses(b))} ({p(effectiveLossRatio(b))})
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Casualties reduced by the game</span>
          <span>{n(b.attacker.casualtiesReduced)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Defender killed</span>
          <span>
            {n(b.defender.dead)} ({p(enemyLossRatio(b))})
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Traps destroyed</span>
          <span>
            {n(b.traps.destroyed)} / {n(b.traps.total)} ({p(trapsDestroyedRatio(b))})
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Traps remaining</span>
          <span>{n(b.traps.remaining)}</span>
        </div>
        {b.buffs.length > 0 && (
          <>
            <h3 className="pt-2 font-medium">Buff comparison (attacker vs defender)</h3>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs">
              {b.buffs.map((x) => (
                <div key={x.stat} className="contents">
                  <span className="text-zinc-400">{x.stat}</span>
                  <span className="text-right tabular-nums">{x.attacker ?? "-"}%</span>
                  <span className="text-right tabular-nums">{x.defender ?? "-"}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
