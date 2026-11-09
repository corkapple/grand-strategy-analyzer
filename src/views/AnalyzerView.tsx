import { useEffect, useRef, useState } from "react";
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

  const reset = () => {
    setError(null);
    setNotice(null);
    setRaw(null);
    setRecon(null);
    setBattle(null);
    setManual(null);
    setReconFailed(false);
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
      await addRecord(record);
      if (record.kind === "battle") void useCommunity.getState().shareBattle(record.id);
      setNotice(
        record.kind === "battle"
          ? learningSummary(record as BattleRecord, useHistory.getState().records, strategy, lossCap)
          : "Saved to History.",
      );
    } catch (e) {
      setNotice(`Could not save to History: ${(e as Error).message}`);
    }
  };

  /** Shows whatever the screenshots contained (recon, battle, or both) and saves it. */
  const show = (r: AutoResult, shots: ImageInput[], providerId: string) => {
    setRecon(r.recon);
    setBattle(r.battle);
    setReconFailed(r.reconFailed && !r.recon);
    setError(null);
    setRaw(null);
    if (!saveHistory) return;
    // Recon first, so the battle's learning summary can pair with it.
    void (async () => {
      if (r.recon) await save({ kind: "recon", report: r.recon }, shots, providerId);
      if (r.battle) await save({ kind: "battle", report: r.battle }, shots, providerId);
    })();
  };

  const fail = (e: unknown, text?: string) => {
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
    const shots = images; // snapshot: the user may remove screenshots while we wait
    const chain = fallbackCandidates(settings);
    const ask = (id: typeof activeProvider, config: (typeof providers)[typeof activeProvider], fallbacks: typeof chain) =>
      runVision({ providerId: id, config, fallbacks, images: shots, customPrompt, signal: abort.current!.signal });
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
      if (res.note) setFallbackNote(res.note);
      show(parsed, shots, res.providerId);
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

      {fallbackNote && <p className="text-xs text-amber-400">Fallback used: {fallbackNote}.</p>}

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
    </div>
  );
}
