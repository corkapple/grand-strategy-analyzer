import { useMemo } from "react";
import type { BattleRecord, Pair } from "@/lib/history";
import {
  analyzeRules,
  analyzeThresholds,
  BUFF_EDGE_LIMIT,
  MIN_BATTLES,
  type InsightStatus,
} from "@/lib/insights";
import { useSettings } from "@/store/settings";

const CHIP: Record<InsightStatus, string> = {
  supported: "border-green-500 text-green-400",
  "off-triangle": "border-amber-500 text-amber-400",
  questionable: "border-red-500 text-red-400",
  "need-data": "border-border text-zinc-400",
};
const CHIP_LABEL: Record<InsightStatus, string> = {
  supported: "Rule holds",
  "off-triangle": "Won off-chart",
  questionable: "Doubtful",
  "need-data": "Need data",
};

/** Compares the fixed strategy rules with logged results. Suggests only; nothing changes unless you click Apply. */
export default function InsightsPanel({ pairs, battles }: { pairs: Pair[]; battles: BattleRecord[] }) {
  const { strategy, setStrategy } = useSettings();
  const rules = useMemo(() => analyzeRules(pairs, strategy), [pairs, strategy]);
  const limits = useMemo(() => analyzeThresholds(battles, strategy), [battles, strategy]);
  const sk = rules.skipped;
  const skippedTotal = sk.noRecon + sk.mixedDefense + sk.unknownFormation + sk.buffAdvantaged;

  if (!pairs.length) return null;

  return (
    <section className="card space-y-3">
      <div>
        <h3 className="text-sm font-medium">Your rules vs. your results</h3>
        <p className="text-xs text-zinc-500">
          The troop matchup chart is a fixed game rule and is never changed from your results. This panel
          only tells you whether the rules held up, and can adjust your solo limits (click Set to accept).
          Each combination needs {MIN_BATTLES}+ battles.
        </p>
      </div>

      {rules.insights.length === 0 && (
        <p className="text-sm text-zinc-400">No usable battles yet.</p>
      )}
      {rules.insights.map((i) => (
        <div key={i.enemy} className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded border px-2 py-0.5 text-xs ${CHIP[i.status]}`}>{CHIP_LABEL[i.status]}</span>
          <span className="flex-1">{i.message}</span>
        </div>
      ))}

      <p className="text-xs text-zinc-500">
        {rules.usable} of {pairs.length} battles used.
        {skippedTotal > 0 && (
          <>
            {" "}
            Left out:{" "}
            {[
              sk.noRecon && `${sk.noRecon} without a matching recon`,
              sk.mixedDefense && `${sk.mixedDefense} against mixed defenses`,
              sk.unknownFormation && `${sk.unknownFormation} with an unreadable formation`,
              sk.buffAdvantaged &&
                `${sk.buffAdvantaged} where your Crew ATK buff led by over ${BUFF_EDGE_LIMIT} points`,
            ]
              .filter(Boolean)
              .join(", ")}
            .
          </>
        )}
      </p>

      <div className="border-t border-border/50 pt-2">
        <h4 className="text-sm font-medium">Solo limits</h4>
        {limits.solo === 0 ? (
          <p className="text-xs text-zinc-500">
            Mark battles as Solo or Rally (open a battle below) and the app can check its solo limits against them.
          </p>
        ) : limits.insights.length === 0 ? (
          <p className="text-xs text-zinc-500">
            {limits.solo} solo {limits.solo === 1 ? "attack" : "attacks"} labelled; nothing contradicts the current limits.
          </p>
        ) : (
          limits.insights.map((t) => (
            <div key={t.key} className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1">{t.message}</span>
              <button
                className="btn"
                onClick={() =>
                  setStrategy({ ...strategy, thresholds: { ...strategy.thresholds, [t.key]: t.suggested } })
                }
              >
                Set to {t.suggested.toLocaleString("en-US")}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
