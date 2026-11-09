import { useEffect } from "react";
import { MIN_COMMUNITY_N } from "@/lib/community/client";
import { COMMUNITY_URL } from "@/lib/community/config";
import { TROOP_LABEL, type TroopType } from "@/lib/strategy";
import { useCommunity } from "@/store/community";

const pct = (v: number | null, d = 0) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
const enemyLabel = (e: string) => (e === "mixed" ? "No majority" : `${TROOP_LABEL[e as TroopType] ?? e}-heavy`);

/** Win rates from everyone's shared results, per enemy type and the troop type you led with. */
export default function CommunityPanel() {
  const stats = useCommunity((c) => c.stats);
  const load = useCommunity((c) => c.loadStats);
  useEffect(() => {
    void load();
  }, [load]);
  if (!COMMUNITY_URL) return null;
  const groups = (stats?.groups ?? []).filter((g) => g.n >= MIN_COMMUNITY_N);
  return (
    <section className="card space-y-2">
      <h3 className="text-sm font-semibold">Community results</h3>
      {!stats || !stats.samples ? (
        <p className="text-xs text-zinc-400">No shared results yet. They appear here as players send them.</p>
      ) : !groups.length ? (
        <p className="text-xs text-zinc-400">
          {stats.samples} shared results so far; a row appears once {MIN_COMMUNITY_N} attacks share the same enemy type
          and lead troop.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-400">
              <tr>
                <th className="py-1">Enemy</th>
                <th>You led with</th>
                <th>Attacks</th>
                <th>Win rate</th>
                <th>Avg loss</th>
                <th>Force ratio for a cheap win</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={`${g.enemy}${g.lead}`} className="border-t border-border/60">
                  <td className="py-1">{enemyLabel(g.enemy)}</td>
                  <td>{TROOP_LABEL[g.lead as TroopType] ?? g.lead}</td>
                  <td className="tabular-nums">{g.n}</td>
                  <td className="tabular-nums">{pct(g.winRate)}</td>
                  <td className="tabular-nums">{pct(g.avgOurLoss, 1)}</td>
                  <td className="tabular-nums">{g.medianWinRatio != null ? `${g.medianWinRatio}x (${g.cheapWins} wins)` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stats?.generatedAt && <p className="text-xs text-zinc-500">Updated {stats.generatedAt.slice(0, 10)} · {stats.samples} shared results</p>}
    </section>
  );
}
