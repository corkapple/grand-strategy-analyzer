import { useEffect, useMemo, useState } from "react";
import {
  effectiveLossRatio,
  enemyLossRatio,
  matchupStats,
  pairBattles,
  recommendedLead,
  recordTime,
  trapsDestroyedRatio,
  leadTroop,
  type BattleRecord,
  type HistoryRecord,
  type ReconRecord,
} from "@/lib/history";
import CommunityPanel from "@/components/CommunityPanel";
import InsightsPanel from "@/components/InsightsPanel";
import { copyText } from "@/lib/providers";
import { computeStrategy, TROOP_LABEL, type TroopType } from "@/lib/strategy";
import { useHistory } from "@/store/history";
import { useSettings } from "@/store/settings";

const pc = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const label = (t: TroopType | "unknown" | null) => (t && t !== "unknown" ? TROOP_LABEL[t] : "?");
const when = (r: HistoryRecord) => new Date(recordTime(r)).toLocaleString();

function Thumbs({ recs }: { recs: (HistoryRecord | null)[] }) {
  const thumbs = recs.flatMap((r) => r?.thumbs ?? []);
  if (!thumbs.length) return <p className="text-xs text-zinc-500">No screenshots stored.</p>;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {thumbs.map((t, i) => (
        <img key={i} src={t} className="h-56 rounded border border-border" />
      ))}
    </div>
  );
}

function Del({ id }: { id: string }) {
  const remove = useHistory((s) => s.remove);
  return (
    <button className="text-xs text-zinc-500 hover:text-red-400" onClick={() => void remove(id)}>
      delete
    </button>
  );
}

function enemyMix(r: ReconRecord) {
  const s = computeStrategy(r.report);
  return (Object.keys(TROOP_LABEL) as TroopType[])
    .filter((t) => s.shares[t] > 0.005)
    .sort((a, b) => s.shares[b] - s.shares[a])
    .map((t) => `${TROOP_LABEL[t]} ${pc(s.shares[t])}`)
    .join(", ");
}

export default function HistoryView() {
  const { records, loaded, error, load, clear, setAttackType } = useHistory();
  const strategy = useSettings((s) => s.strategy);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const pairs = useMemo(() => pairBattles(records), [records]);
  const stats = useMemo(
    () => matchupStats(pairs, (r) => recommendedLead(r, strategy), strategy.formations),
    [pairs, strategy],
  );
  const battles = useMemo(
    () => records.filter((r): r is BattleRecord => r.kind === "battle"),
    [records],
  );
  const usedRecons = new Set(pairs.flatMap((p) => (p.recon ? [p.recon.id] : [])));
  const loneRecons = records
    .filter((r): r is ReconRecord => r.kind === "recon" && !usedRecons.has(r.id))
    .sort((a, b) => recordTime(b) - recordTime(a));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">History</h2>
        <span className="text-xs text-zinc-500">
          {records.length} saved · stored only on this computer
        </span>
        <div className="ml-auto flex gap-2">
          <button
            className="btn"
            disabled={!records.length}
            onClick={async () => {
              // Strip screenshots to keep the JSON small enough to paste.
              await copyText(JSON.stringify(records.map((r) => ({ ...r, thumbs: undefined })), null, 1));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied!" : "Copy as JSON"}
          </button>
          {confirmClear ? (
            <button
              className="btn border-red-500 text-red-400"
              onClick={async () => {
                await clear();
                setConfirmClear(false);
              }}
            >
              Really delete all?
            </button>
          ) : (
            <button className="btn" disabled={!records.length} onClick={() => setConfirmClear(true)}>
              Delete all
            </button>
          )}
        </div>
      </div>
      {error && <div className="card border-red-500 text-sm text-red-400">{error}</div>}
      {loaded && !records.length && (
        <p className="text-sm text-zinc-400">
          Nothing saved yet. Analyze a recon and then the matching victory/defeat mail; they are paired
          automatically by coordinates and time.
        </p>
      )}

      <InsightsPanel pairs={pairs} battles={battles} />
      <CommunityPanel />

      {stats.length > 0 && (
        <section className="card">
          <h3 className="mb-1 text-sm font-medium">What worked (paired recon + battle)</h3>
          <p className="mb-2 text-xs text-zinc-500">
            Small samples and big buff gaps (see each battle) can dominate results. Treat as evidence, not proof.
          </p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-400">
              <tr>
                <th className="py-1">Enemy mostly</th>
                <th>You led with</th>
                <th>Battles</th>
                <th>Wins</th>
                <th>Your losses</th>
                <th>Enemy killed</th>
                <th>Followed advice</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={`${s.enemy}${s.ours}`} className="border-t border-border/50">
                  <td className="py-1">{label(s.enemy)}</td>
                  <td>{label(s.ours)}</td>
                  <td>{s.n}</td>
                  <td>{s.wins}</td>
                  <td>{pc(s.avgOurLoss, 2)}</td>
                  <td>{pc(s.avgEnemyLoss)}</td>
                  <td>
                    {s.followedAdvice}/{s.n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {pairs.map(({ battle, recon }) => {
        const b = battle.report;
        const ours = leadTroop(b, strategy.formations);
        const advice = recon ? recommendedLead(recon.report, strategy) : null;
        const crewAtk = b.buffs.find((x) => /crew\s*atk/i.test(x.stat));
        return (
          <details key={battle.id} className="card">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className={b.result === "victory" ? "text-green-400" : "text-red-400"}>
                {b.result === "victory" ? "Victory" : b.result === "defeat" ? "Defeat" : "?"}
              </span>
              <span>
                {b.target?.level ? `Lv.${b.target.level} ` : ""}
                {b.target?.name ?? "Target"}{" "}
                {b.location?.x != null && `(${b.location.x}, ${b.location.y})`}
              </span>
              <span className="text-xs text-zinc-500">{when(battle)}</span>
              <span className="ml-auto text-xs">
                {recon ? (advice === ours ? "followed advice" : `advice was ${label(advice)}`) : "no matching recon"}
              </span>
            </summary>
            <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              <div>Enemy before: {recon ? enemyMix(recon) : "-"}</div>
              <div>
                Your formation: {b.attacker.formation ?? "-"} ({b.attacker.totalAssociates.toLocaleString("en-US")})
              </div>
              <div>Your real losses: {pc(effectiveLossRatio(b), 2)}</div>
              <div>Enemy killed: {pc(enemyLossRatio(b))}</div>
              <div>
                Force ratio:{" "}
                {b.defender.totalAssociates ? (b.attacker.totalAssociates / b.defender.totalAssociates).toFixed(2) : "-"}x
              </div>
              <div>Traps destroyed: {pc(trapsDestroyedRatio(b))}</div>
              <div>
                Crew ATK buff: {crewAtk ? `${crewAtk.attacker}% vs ${crewAtk.defender}%` : "-"}
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-zinc-400">This attack was a</span>
              <select
                className="input w-auto"
                value={battle.attackType ?? ""}
                onChange={(e) =>
                  void setAttackType(battle.id, (e.target.value || undefined) as "solo" | "rally" | undefined)
                }
              >
                <option value="">not set</option>
                <option value="solo">solo attack</option>
                <option value="rally">rally</option>
              </select>
            </label>
            <Thumbs recs={[recon, battle]} />
            <div className="mt-2 flex gap-3">
              <Del id={battle.id} />
              {recon && <Del id={recon.id} />}
            </div>
          </details>
        );
      })}

      {loneRecons.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-400">Recons without a battle yet</h3>
          {loneRecons.map((r) => (
            <details key={r.id} className="card">
              <summary className="flex cursor-pointer flex-wrap gap-x-4 text-sm">
                <span>
                  {r.report.building?.level ? `Lv.${r.report.building.level} ` : ""}
                  {r.report.building?.name ?? "Target"}{" "}
                  {r.report.location?.x != null && `(${r.report.location.x}, ${r.report.location.y})`}
                </span>
                <span className="text-xs text-zinc-500">{when(r)}</span>
                <span className="ml-auto text-xs">{enemyMix(r)}</span>
              </summary>
              <Thumbs recs={[r]} />
              <div className="mt-2">
                <Del id={r.id} />
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
