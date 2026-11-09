import { useEffect, useState } from "react";
import type { KnowledgeEntry } from "@/lib/knowledge";
import { TROOP_LABEL } from "@/lib/strategy";
import { useKnowledge } from "@/store/knowledge";
import { useSettings } from "@/store/settings";

function Entry({ e }: { e: KnowledgeEntry }) {
  const setStatus = useKnowledge((s) => s.setStatus);
  const remove = useKnowledge((s) => s.remove);
  const conflict = e.chart === "conflicts";
  return (
    <div className={`rounded-md border p-2 text-sm ${conflict ? "border-red-500/60" : "border-border/60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-border px-1.5 text-xs text-zinc-400">{e.kind}</span>
        {e.chart === "matches" && <span className="rounded border border-green-500 px-1.5 text-xs text-green-400">matches the game's chart</span>}
        {conflict && <span className="rounded border border-red-500 px-1.5 text-xs text-red-400">contradicts the game's chart</span>}
        <span className="flex-1">{e.statement}</span>
      </div>
      {e.formation && (
        <p className="mt-1 text-xs text-amber-400">
          If accepted: when leading with {TROOP_LABEL[e.formation.lead]}, the app will recommend "{e.formation.name}".
        </p>
      )}
      {conflict && (
        <p className="mt-1 text-xs text-red-400">
          Not applied: the in-game chart is a fixed rule. This is probably a misreading or a different game version.
        </p>
      )}
      <p className="mt-1 text-xs italic text-zinc-500">
        "{e.quote}" — {e.sourceTitle} ({new URL(e.sourceUrl).hostname})
      </p>
      <div className="mt-1 flex gap-3 text-xs">
        {e.status === "pending" && (
          <>
            <button className="btn" disabled={conflict} onClick={() => void setStatus(e.id, "accepted")}>
              Accept
            </button>
            <button className="btn" onClick={() => void setStatus(e.id, "rejected")}>
              Reject
            </button>
          </>
        )}
        {e.status !== "pending" && (
          <button className="text-zinc-500 hover:text-zinc-200" onClick={() => void setStatus(e.id, "pending")}>
            move back to review
          </button>
        )}
        <button className="text-zinc-500 hover:text-red-400" onClick={() => void remove(e.id)}>
          delete
        </button>
      </div>
    </div>
  );
}

export default function KnowledgeView() {
  const { entries, loaded, checking, log, error, load, check, discover, discovering, suggestions, discoverNotes, dismissSuggestion } =
    useKnowledge();
  const s = useSettings();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [urlError, setUrlError] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const pending = entries.filter((e) => e.status === "pending");
  const accepted = entries.filter((e) => e.status === "accepted");
  const rejected = entries.filter((e) => e.status === "rejected");

  const add = () => {
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "https:") throw new Error();
      s.addSource(u.toString(), label.trim() || u.hostname);
      setUrl("");
      setLabel("");
      setUrlError("");
    } catch {
      setUrlError("Enter a full https:// address.");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Game knowledge</h2>
          <p className="text-xs text-zinc-500">
            The app re-reads the guide pages below with your chosen AI provider and proposes facts. Each fact must
            quote the page; nothing changes the recommendations until you accept it, and anything that contradicts the
            in-game matchup chart cannot be accepted. Page text is sent to the AI provider you selected.
          </p>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" checked={s.autoUpdate} onChange={(e) => s.setAutoUpdate(e.target.checked)} />
          Check for updates automatically when the app starts, every
          <input
            className="input w-16"
            type="number"
            min={1}
            max={90}
            value={s.updateIntervalDays}
            onChange={(e) => s.setUpdateIntervalDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))}
          />
          days
        </label>

        <div className="space-y-2">
          {s.knowledgeSources.map((src) => (
            <div key={src.id} className="flex flex-wrap items-center gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">{src.label}</div>
                <div className="truncate text-xs text-zinc-500">
                  {src.url}
                  {src.lastChecked ? ` · checked ${new Date(src.lastChecked).toLocaleDateString()}` : " · never checked"}
                  {src.lastStatus ? ` · ${src.lastStatus}` : ""}
                </div>
              </div>
              <button className="text-xs text-zinc-500 hover:text-red-400" onClick={() => s.removeSource(src.id)}>
                remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <input className="input flex-1" placeholder="https://… guide address" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input w-48" placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn" onClick={add}>
            Add source
          </button>
        </div>
        {urlError && <p className="text-xs text-red-400">{urlError}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={checking} onClick={() => void check({})}>
            {checking ? "Checking…" : "Check now"}
          </button>
          <button className="btn" disabled={checking} onClick={() => void check({ force: true })}>
            Re-read even if unchanged
          </button>
        </div>
        <div className="space-y-2 border-t border-border/50 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" disabled={discovering} onClick={() => void discover()}>
              {discovering ? "Searching…" : "Find new guides"}
            </button>
            <span className="text-xs text-zinc-500">
              Uses Gemini with Google Search. Only pages that load, are on a site the search returned, and mention the
              game are suggested. Nothing is added until you click Add.
            </span>
          </div>
          {suggestions.map((sg) => (
            <div key={sg.url} className="flex flex-wrap items-center gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">{sg.title}</div>
                <div className="truncate text-xs text-zinc-500">{sg.url}</div>
              </div>
              <button
                className="btn"
                onClick={() => {
                  s.addSource(sg.url, sg.title);
                  dismissSuggestion(sg.url);
                }}
              >
                Add
              </button>
              <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={() => dismissSuggestion(sg.url)}>
                dismiss
              </button>
            </div>
          ))}
          {discoverNotes.map((n) => (
            <p key={n} className="text-xs text-zinc-500">
              {n}
            </p>
          ))}
        </div>
        {log.map((l) => (
          <p key={l} className="text-xs text-zinc-400">
            {l}
          </p>
        ))}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </section>

      <section className="card space-y-2">
        <h3 className="text-sm font-medium">To review ({pending.length})</h3>
        {pending.length === 0 && <p className="text-xs text-zinc-500">Nothing waiting. New facts from guides appear here.</p>}
        {pending.map((e) => (
          <Entry key={e.id} e={e} />
        ))}
      </section>

      <section className="card space-y-2">
        <h3 className="text-sm font-medium">Accepted ({accepted.length})</h3>
        {accepted.map((e) => (
          <Entry key={e.id} e={e} />
        ))}
      </section>

      {rejected.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm text-zinc-400">Rejected ({rejected.length})</summary>
          <div className="mt-2 space-y-2">
            {rejected.map((e) => (
              <Entry key={e.id} e={e} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
