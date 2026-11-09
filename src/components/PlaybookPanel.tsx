import { useEffect, useMemo } from "react";
import { pairBattles } from "@/lib/history";
import { armyNeeded, buildPlaybook } from "@/lib/playbook";
import type { CombatReport } from "@/lib/schema";
import { TROOP_LABEL } from "@/lib/strategy";
import { useHistory } from "@/store/history";
import { useSettings } from "@/store/settings";

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const pc = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

/** "Repeat what worked": your own past wins against similar defenses. */
export default function PlaybookPanel({ report }: { report: CombatReport }) {
  const { strategy, lossCap, myAssociates, setMyAssociates } = useSettings();
  const { records, loaded, load } = useHistory();
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const pairs = useMemo(() => pairBattles(records), [records]);
  const book = useMemo(() => buildPlaybook(report, pairs, strategy, lossCap), [report, pairs, strategy, lossCap]);
  const target = report.associates.total;
  const best = book.precedents[0];
  const { goodWins, costlyWins, defeats } = book.family;

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">Your playbook</h3>
        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          Your available associates
          <input
            className="input w-36"
            type="number"
            min={0}
            placeholder="e.g. 2000000"
            value={myAssociates || ""}
            onChange={(e) => setMyAssociates(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>

      {!best ? (
        <p className="text-sm text-zinc-400">
          No close precedent yet (a past win against a similar defense with losses under {pc(lossCap)}). Follow the
          matchup advice above, then log the result with Battle result so next time the app can reuse it.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-green-400">Repeat what worked</p>
          {book.precedents.slice(0, 3).map((p, i) => {
            const need = armyNeeded(p, target);
            return (
              <div key={p.id} className="rounded-md border border-border/60 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{p.formation ?? "Unknown formation"}</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(p.when).toLocaleDateString()} · similarity {pc(p.score)}
                  </span>
                  {i === 0 && <span className="rounded border border-green-500 px-1.5 text-xs text-green-400">best match</span>}
                  <span className={`ml-auto rounded border px-1.5 text-xs ${p.onChart ? "border-border text-zinc-400" : "border-amber-500 text-amber-400"}`}>
                    {p.onChart ? "matchup chart favoured you" : "against the chart"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  You sent {n(p.ourAssociates)} associates against {n(p.theirAssociates)} ({p.forceRatio.toFixed(2)}x), won,
                  real losses {pc(p.lossRatio, 2)}
                  {p.buffEdge !== null && `, Crew ATK buff ${p.buffEdge >= 0 ? "+" : ""}${Math.round(p.buffEdge)} pts vs them`}.
                  {!p.onChart && p.chartLead && ` The chart favoured ${TROOP_LABEL[p.chartLead]} here; this win may owe more to power than tactics.`}
                </p>
                <p className="mt-1 text-xs">
                  Repeating it here needs about <b>{n(need)}</b> associates
                  {myAssociates > 0 &&
                    (myAssociates >= need ? (
                      <span className="text-green-400"> — you have {n(myAssociates)}, enough.</span>
                    ) : (
                      <span className="text-amber-400"> — you have {n(myAssociates)}, short by {n(need - myAssociates)}.</span>
                    ))}
                  .
                </p>
              </div>
            );
          })}
        </div>
      )}

      {(goodWins + costlyWins + defeats > 0 || book.minRatioOnChart !== null || book.minRatioOffChart !== null) && (
        <div className="space-y-1 border-t border-border/50 pt-2 text-xs text-zinc-400">
          <p>
            Against defenses with the same main troop type: {goodWins} good {goodWins === 1 ? "win" : "wins"}, {costlyWins} costly{" "}
            {costlyWins === 1 ? "win" : "wins"} (losses over {pc(lossCap)}), {defeats} {defeats === 1 ? "defeat" : "defeats"}.
          </p>
          {book.minRatioOnChart !== null && (
            <p>
              Smallest force that won with the chart on your side: {book.minRatioOnChart.toFixed(2)}x their associates (about{" "}
              {n(book.minRatioOnChart * target)} here).
            </p>
          )}
          {book.minRatioOffChart !== null && (
            <p>
              Smallest force that won against the chart: {book.minRatioOffChart.toFixed(2)}x (about {n(book.minRatioOffChart * target)} here).
            </p>
          )}
          {defeats === 0 && (
            <p>
              No defeats logged, so these are amounts that were enough, not proven minimums. Real minimums need a few close calls.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
