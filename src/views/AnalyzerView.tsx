import { useEffect, useMemo, useRef, useState } from "react";
import BattleDashboard from "@/components/BattleDashboard";
import Dashboard from "@/components/Dashboard";
import DropZone from "@/components/DropZone";
import { runVision, thumbnail } from "@/lib/analyze";
import type { BattleRecord, HistoryRecord } from "@/lib/history";
import { learningSummary } from "@/lib/playbook";
import type { ReportKind } from "@/lib/prompt";
import { getProvider, type ImageInput } from "@/lib/providers";
import { CHAT_SITES, copyCombined, copyImage, copyText, openChat } from "@/lib/providers/clipboard";
import { buildUserPrompt, systemPromptFor } from "@/lib/prompt";
import { fallbackCandidates } from "@/lib/providers/fallback";
import {
  parseAuto,
  ReportParseError,
  type AutoResult,
  type BattleReport,
  type CombatReport,
} from "@/lib/schema";
import RematchPanel from "@/components/RematchPanel";
import { debugReport, lastRun, log, newRun } from "@/lib/log";
import { fingerprint, leadInfo, pairBattles } from "@/lib/history";
import { TROOP_LABEL } from "@/lib/strategy";
import { useCommunity } from "@/store/community";
import { useHistory } from "@/store/history";
import { useSettings } from "@/store/settings";

export default function AnalyzerView() {
  const settings = useSettings();
  const { activeProvider, providers, customPrompt, strategy, saveHistory, lossCap } = settings;
  const addRecord = useHistory((s) => s.add);
  const [reconFailed, setReconFailed] = useState(false);
  const [images, setImages] = useState<ImageInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [answeredBy, setAnsweredBy] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  // Development only: documentation screenshots pre-fill a result (see src/dev/shots.tsx).
  const demo = import.meta.env.DEV || import.meta.env.MODE === "docs" ? (window as unknown as { __gsaDemo?: { recon?: CombatReport; battle?: BattleReport } }).__gsaDemo : undefined;
  const [recon, setRecon] = useState<CombatReport | null>(demo?.recon ?? null);
  const [battle, setBattle] = useState<BattleReport | null>(demo?.battle ?? null);
  /** A best-effort reading nothing could verify: shown, but only saved if the user says so. */
  const [unsaved, setUnsaved] = useState<{ r: AutoResult; shots: ImageInput[]; providerId: string } | null>(null);
  const [runId, setRunId] = useState<string | undefined>(lastRun());
  const [copiedDebug, setCopiedDebug] = useState(false);
  const [manual, setManual] = useState<{ prompt: string; reply: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Seconds spent waiting, so a slow free model is distinguishable from a hang.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const provider = getProvider(activeProvider);
  const records = useHistory((s) => s.records);
  const setLedWith = useHistory((s) => s.setLedWith);
  // The saved copy of the battle on screen (it holds what the user says they led with).
  const savedBattle = useMemo(() => {
    if (!battle) return null;
    const fp = fingerprint({ id: "v", kind: "battle", createdAt: 0, thumbs: [], report: battle });
    return fp ? ((records.find((r) => r.kind === "battle" && fingerprint(r) === fp) as BattleRecord | undefined) ?? null) : null;
  }, [battle, records]);
  const leadSource = battle ? leadInfo(battle, strategy.formations, savedBattle?.ledWith).source : null;
  // The enemy this battle faced: a recon of the same target, or the mix read from its Battle Details screen.
  const enemy = useMemo(() => {
    if (!battle) return null;
    const view = { id: "__view", kind: "battle" as const, createdAt: Date.now(), thumbs: [], report: battle };
    return pairBattles([...records, view]).find((p) => p.battle.id === "__view")?.recon?.report ?? null;
  }, [battle, records]);

  const reset = () => {
    setError(null);
    setNotice(null);
    setRaw(null);
    setRecon(null);
    setBattle(null);
    setManual(null);
    setReconFailed(false);
    setUnsaved(null);
  };

  const save = async (
    rec: Omit<HistoryRecord, "thumbs" | "id" | "createdAt"> & { kind: ReportKind },
    shots: ImageInput[],
    providerId: string,
  ) => {
    try {
      const thumbs = await Promise.all(shots.map((i) => thumbnail(i)));
      const record = {
        ...rec,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        thumbs,
        provider: providerId,
      } as HistoryRecord;
      const stored = await addRecord(record);
      log("history.saved", { kind: stored.kind, replacedExisting: stored.id !== record.id });
      if (stored.kind === "battle") void useCommunity.getState().shareBattle(stored.id);
      setNotice(
        stored.kind === "battle"
          ? learningSummary(stored as BattleRecord, useHistory.getState().records, strategy, lossCap)
          : "Saved to History.",
      );
    } catch (e) {
      setNotice(`Could not save to History: ${(e as Error).message}`);
    }
  };

  /** Shows whatever the screenshots contained (recon, battle, or both) and saves it. */
  const saveResult = (r: AutoResult, shots: ImageInput[], providerId: string) => {
    // Recon first, so the battle's learning summary can pair with it.
    void (async () => {
      if (r.recon) await save({ kind: "recon", report: r.recon }, shots, providerId);
      if (r.battle) await save({ kind: "battle", report: r.battle }, shots, providerId);
    })();
  };

  const show = (r: AutoResult, shots: ImageInput[], providerId: string, verified = true) => {
    setRecon(r.recon);
    setBattle(r.battle);
    setReconFailed(r.reconFailed && !r.recon);
    setError(null);
    setRaw(null);
    setUnsaved(null);
    if (!saveHistory) return;
    // A reading nothing could confirm must not teach the playbook or the community stats by itself.
    if (!verified) {
      log("analyze.not_saved", { why: "unverified on-device reading" }, "warn");
      setUnsaved({ r, shots, providerId });
      return;
    }
    saveResult(r, shots, providerId);
  };

  const fail = (e: unknown, text?: string) => {
    log("analyze.error", { message: (e as Error).message, reply: e instanceof ReportParseError ? e.raw.slice(0, 300) : text?.slice(0, 300) }, "error");
    setError((e as Error).message);
    setRaw(e instanceof ReportParseError ? e.raw : (text ?? null));
  };

  // Manual (web chat) flow: the user pastes the reply.
  const parse = (text: string) => {
    try {
      show(parseAuto(text), images, "manual");
    } catch (e) {
      fail(e, text);
    }
  };

  /** No API worked: copy the prompt so the user can finish in any web chat. */
  const startManual = async () => {
    const res = await getProvider("clipboard").analyze(
      {
        images,
        systemPrompt: systemPromptFor("auto"),
        userPrompt: buildUserPrompt(images.length, customPrompt),
      },
      {},
    );
    setManual({ prompt: res.manualPrompt ?? "", reply: "" });
  };

  const run = async () => {
    abort.current = new AbortController();
    setRunId(newRun());
    const shots = images; // snapshot: the user may remove screenshots while we wait
    const chain = fallbackCandidates(settings);
    const ask = (id: typeof activeProvider, config: (typeof providers)[typeof activeProvider], fallbacks: typeof chain) =>
      runVision({ providerId: id, config, fallbacks, localFirst: settings.localFirst, images: shots, customPrompt, signal: abort.current!.signal });
    log("analyze.start", { images: shots.length, main: activeProvider, localFirst: settings.localFirst, fallbacks: chain.map((c) => c.id) });
    setBusy(true);
    setAnsweredBy(null);
    setFallbackNote(null);
    reset();
    try {
      let res = await ask(activeProvider, providers[activeProvider], chain);
      if (res.status === "awaiting-manual-response") {
        setManual({ prompt: res.manualPrompt ?? "", reply: "" });
        return;
      }
      let parsed: AutoResult;
      try {
        parsed = parseAuto(res.text);
      } catch (e) {
        // The provider answered but the output was unreadable: give the second provider one try.
        const next = chain[0];
        if (!(e instanceof ReportParseError) || !e.retryable || !next || res.providerId !== activeProvider) {
          setAnsweredBy(res.model ?? null);
          throw e;
        }
        const again = await ask(next.id, next.config, []);
        if (again.status !== "complete") throw e;
        parsed = parseAuto(again.text);
        res = {
          ...again,
          note: `${provider.label} returned unreadable data (${e.message.slice(0, 90)}); answered by ${getProvider(next.id).label}`,
        };
      }
      setAnsweredBy(res.model ?? null);
      log("analyze.result", {
        answeredBy: res.model,
        recon: parsed.recon && { associates: parsed.recon.associates, traps: parsed.recon.traps.total, confidence: parsed.recon.confidence },
        battle: parsed.battle && {
          result: parsed.battle.result,
          confidence: parsed.battle.confidence,
          attacker: { ...parsed.battle.attacker, ...(({ lead, source }) => ({ lead, leadSource: source }))(leadInfo(parsed.battle, strategy.formations)) },
          defender: { ...parsed.battle.defender },
          enemyMixKnown: !!parsed.battle.defender.troops,
          notes: parsed.battle.notes,
        },
        reconFailed: parsed.reconFailed,
      });
      if (res.note) setFallbackNote(res.note);
      show(parsed, shots, res.providerId, !/unverified/i.test(res.model ?? ""));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <p className="text-sm text-zinc-400">
        Drop every screenshot of one attack together: the recon report, the victory/defeat mail and its Battle Details.
        The app sorts them out itself.
      </p>
      <DropZone images={images} onChange={setImages} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={!images.length || busy} onClick={() => void run()}>
          {busy ? `Analyzing… ${elapsed}s` : "Analyze"}
        </button>
        {runId && !busy && (
          <button
            className="btn"
            title="Copies a short, private report of what the app just did, to paste when asking for help"
            onClick={() => {
              void copyText(debugReport({ run: runId })).then(() => {
                setCopiedDebug(true);
                setTimeout(() => setCopiedDebug(false), 2000);
              });
            }}
          >
            {copiedDebug ? "Copied!" : "Copy debug info"}
          </button>
        )}
        {busy && (
          <button className="btn" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        )}
        <span className="text-xs text-zinc-500">
          Provider: {provider.label}
          {answeredBy && ` · answered by ${answeredBy}`}
        </span>
        {notice && <span className="text-xs text-green-400">{notice}</span>}
      </div>

      {unsaved && (
        <div className="card flex flex-wrap items-center gap-3 border-amber-500/60 text-sm">
          <span className="text-amber-400">
            This reading could not be verified, so it was <b>not saved</b>. Check the numbers against your screenshot first.
          </span>
          <button
            className="btn"
            onClick={() => {
              saveResult(unsaved.r, unsaved.shots, unsaved.providerId);
              setUnsaved(null);
            }}
          >
            Save anyway
          </button>
        </div>
      )}

      {fallbackNote && (
        <p className="whitespace-pre-line text-xs text-amber-400">
          Fallback used:{"\n"}
          {fallbackNote}
        </p>
      )}

      {busy && elapsed >= 25 && (
        <p className="text-xs text-amber-400">
          Still waiting. Free models can queue or be slow. With OpenRouter's free tier the app tries several free models
          in turn (45 seconds each). You can Cancel, or use Gemini, which is usually faster.
        </p>
      )}

      {error && (
        <div className="card whitespace-pre-line border-red-500 text-sm text-red-400">
          {error}
          {raw && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-400">
              {raw}
            </pre>
          )}
          {!manual && images.length > 0 && !busy && (
            <button className="btn mt-3 text-zinc-200" onClick={() => void startManual()}>
              Finish in a web chat instead (copy prompt)
            </button>
          )}
        </div>
      )}

      {!recon && (reconFailed || error) && (
        <div className="card border-amber-500/60 text-sm">
          <span className="font-medium text-amber-400">
            {reconFailed ? "Recon failed." : "No usable recon."} Send a full 100% Bikers raid.
          </span>{" "}
          <span className="text-zinc-300">
            Formation: {strategy.formations.bikers}. Without defense numbers, Bikers are the default attack.
          </span>
        </div>
      )}

      {manual && (
        <div className="card space-y-3 text-sm">
          <p className="font-medium">Finish in a web chat (about a minute)</p>
          <ol className="list-decimal space-y-1 pl-5 text-zinc-300">
            <li>The prompt is already on your clipboard. Open a chat below and paste it (Cmd/Ctrl+V).</li>
            <li>Click "Copy all screenshots as one image" and paste it into the chat too (Cmd/Ctrl+V).</li>
            <li>Send, copy the reply, and paste it into the box below.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {CHAT_SITES.map((c) => (
              <button
                key={c.id}
                className="btn"
                onClick={() => {
                  void copyText(manual.prompt)
                    .then(() => openChat(c.id))
                    .catch((e) => setError(String(e)));
                }}
              >
                Open {c.label}
              </button>
            ))}
            <button className="btn" onClick={() => void copyText(manual.prompt).catch((e) => setError(String(e)))}>
              Copy prompt again
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {images.length > 1 && (
              <button className="btn btn-primary" onClick={() => copyCombined(images).catch((e) => setError(String(e)))}>
                Copy all screenshots as one image
              </button>
            )}
            {images.map((img, i) => (
              <button key={i} className="btn" onClick={() => copyImage(img).catch((e) => setError(String(e)))}>
                Copy screenshot {i + 1}
              </button>
            ))}
          </div>
          <textarea
            className="input h-32 font-mono text-xs"
            value={manual.reply}
            onChange={(e) => setManual({ ...manual, reply: e.target.value })}
            placeholder="Paste the model's reply here…"
          />
          <button className="btn btn-primary" disabled={!manual.reply.trim()} onClick={() => parse(manual.reply)}>
            Parse reply
          </button>
        </div>
      )}

      {recon && <Dashboard report={recon} config={strategy} />}
      {battle && <BattleDashboard report={battle} />}
      {battle && savedBattle && leadSource !== "troops" && leadSource !== "you" && (
        <section className="card flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-300">The troops you sent could not be read. What did you lead with?</span>
          {(["bruisers", "hitmen", "bikers"] as const).map((t) => (
            <button
              key={t}
              className="btn"
              onClick={() => {
                log("lead.set", { lead: t });
                void setLedWith(savedBattle.id, t).then(() => useCommunity.getState().shareBattle(savedBattle.id));
              }}
            >
              {TROOP_LABEL[t]}
            </button>
          ))}
          <span className="text-xs text-zinc-500">Your answer is saved with the battle and used for the advice and your stats.</span>
        </section>
      )}
      {battle && !recon && <RematchPanel battle={battle} enemy={enemy} config={strategy} ledWith={savedBattle?.ledWith} />}
    </div>
  );
}
