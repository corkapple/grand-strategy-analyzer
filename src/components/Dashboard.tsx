import { useState } from "react";
import PlaybookPanel from "@/components/PlaybookPanel";
import { communityFor } from "@/lib/community/client";
import { enemyKey } from "@/lib/community/enemyKey";
import { recommendedLead } from "@/lib/history";
import { copyText } from "@/lib/providers";
import type { CombatReport } from "@/lib/schema";
import { useCommunity } from "@/store/community";
import {
  computeStrategy,
  formatChatMessage,
  TROOP_LABEL,
  verdictText,
  type StrategyConfig,
  type TroopType,
} from "@/lib/strategy";

const n = (v: number) => v.toLocaleString("en-US");

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="tabular-nums">{typeof value === "number" ? n(value) : value}</span>
    </div>
  );
}

const VERDICT_STYLE = {
  "solo-ok": "border-green-500 text-green-400",
  rally: "border-amber-500 text-amber-400",
  "heavy-rally": "border-red-500 text-red-400",
} as const;

export default function Dashboard({
  report,
  config,
}: {
  report: CombatReport;
  config: StrategyConfig;
}) {
  const s = computeStrategy(report, config);
  const [copied, setCopied] = useState(false);
  const chat = formatChatMessage(report, s);
  const stats = useCommunity((c) => c.stats);
  const total = Object.values(s.shares).reduce((a, b) => a + b, 0);
  const lead = recommendedLead(report, config);
  const community =
    total > 0 && lead
      ? communityFor(stats, enemyKey({ bruisers: s.shares.bruisers, hitmen: s.shares.hitmen, bikers: s.shares.bikers }), lead)
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card">
        <h2 className="mb-2 font-semibold">
          {report.building?.level ? `Lv.${report.building.level} ` : ""}
          {report.building?.name ?? "Target"}
          <span className="ml-2 text-xs text-zinc-500">confidence: {report.confidence}</span>
        </h2>
        {report.notes && <p className="mb-2 text-xs text-amber-400">{report.notes}</p>}
        <Row label="Wall durability" value={`${n(report.wallDurability.current)} / ${n(report.wallDurability.max)}`} />
        <Row label="Enforcers" value={report.enforcers.count} />
        <h3 className="mt-3 text-sm font-medium">Traps ({n(report.traps.total)})</h3>
        <Row label="Lacerator" value={report.traps.lacerator} />
        <Row label="Pineapple Grenade" value={report.traps.pineappleGrenade} />
        <Row label="Napalm Bomb" value={report.traps.napalmBomb} />
        <h3 className="mt-3 text-sm font-medium">Defensive Associates ({n(report.associates.total)})</h3>
        {(Object.keys(TROOP_LABEL) as TroopType[]).map((t) => (
          <Row
            key={t}
            label={`${TROOP_LABEL[t]} (${Math.round(s.shares[t] * 100)}%)`}
            value={report.associates[t]}
          />
        ))}
      </section>

      <section className="card space-y-3">
        <div className={`rounded-md border px-3 py-2 font-semibold ${VERDICT_STYLE[s.verdict]}`}>
          {verdictText(s.verdict)}
          {community && (
            <p className="mt-1 text-xs font-normal text-zinc-300">
              Community: {community.n} similar attacks led with {lead ? TROOP_LABEL[lead] : ""} won {Math.round(community.winRate * 100)}% (average loss{" "}
              {(community.avgOurLoss * 100).toFixed(1)}%).
            </p>
          )}
          {s.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs font-normal">
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium">Counter composition</h3>
          {Object.entries(s.composition)
            .sort((a, b) => b[1] - a[1])
            .map(([t, p]) => (
              <div key={t} className="mt-1">
                <div className="flex justify-between text-sm">
                  <span>{TROOP_LABEL[t as TroopType]}</span>
                  <span>{p}%</span>
                </div>
                <div className="h-2 rounded bg-bg">
                  <div className="h-2 rounded bg-accent" style={{ width: `${p}%` }} />
                </div>
              </div>
            ))}
        </div>
        {s.notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-400">
            {s.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <Row label="Recommended formation" value={s.formation} />
        {s.dominantTrap && (
          <Row
            label="Main trap threat"
            value={`${s.dominantTrap.name} (${Math.round(s.dominantTrap.share * 100)}%)`}
          />
        )}
        <pre className="whitespace-pre-wrap rounded-md bg-bg p-2 text-xs">{chat}</pre>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await copyText(chat);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied!" : "Copy for chat"}
        </button>
      </section>
      <div className="lg:col-span-2">
        <PlaybookPanel report={report} />
      </div>
    </div>
  );
}
