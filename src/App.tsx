import { useEffect, useState } from "react";
import AnalyzerView from "./views/AnalyzerView";
import HistoryView from "./views/HistoryView";
import KnowledgeView from "./views/KnowledgeView";
import SettingsView from "./views/SettingsView";
import { log, setLogEnabled } from "./lib/log";
import { useCommunity } from "./store/community";
import { useHistory } from "./store/history";
import { useKnowledge } from "./store/knowledge";
import { useSettings } from "./store/settings";
import { inTauri } from "./lib/secrets";
import { startUpdateChecks, useUpdater } from "./store/updater";

type View = "analyzer" | "history" | "knowledge" | "settings";

export default function App({ initialView = "analyzer" }: { initialView?: View }) {
  const [view, setView] = useState<View>(initialView);

  // Load saved history and knowledge once, so pairing and the playbook see everything from the start.
  useEffect(() => {
    void (async () => {
      await useHistory.getState().load();
      void useKnowledge.getState().load();
      // Community: fetch the shared stats, and send any battles that could not be sent earlier.
      void useCommunity.getState().loadStats();
      void useCommunity.getState().flush();
    })();
  }, []);

  // Diagnostic log: record start-up and any crash, and honour the on/off setting.
  useEffect(() => {
    setLogEnabled(useSettings.getState().keepLog);
    const unsub = useSettings.subscribe((s) => setLogEnabled(s.keepLog));
    const st = useSettings.getState();
    log("app.start", {
      main: st.activeProvider,
      localFirst: st.localFirst,
      fallback: st.fallbackEnabled ? st.fallbackProvider : "off",
      autoFallback: st.autoFallback,
      share: st.shareResults,
      keychain: st.keychain,
      keysSet: Object.entries(st.providers).filter(([, c]) => c.apiKey?.trim()).map(([id]) => id),
    });
    const onError = (e: ErrorEvent) => log("app.error", { message: e.message, at: `${e.filename ?? ""}:${e.lineno ?? ""}` }, "error");
    const onRejection = (e: PromiseRejectionEvent) => log("app.unhandled_rejection", { message: String(e.reason?.message ?? e.reason) }, "error");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      unsub();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // Look for a newer version of the app itself (installed with one click, no download page).
  useEffect(() => startUpdateChecks(), []);

  // Weekly knowledge refresh. Waits until API keys have finished loading from the keychain
  // (the first launch of a new build can show permission prompts that take a while to answer).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      timer = setTimeout(() => {
        if (inTauri && useSettings.getState().autoUpdate) void useKnowledge.getState().check({ onlyDue: true });
      }, 3000);
    };
    if (useSettings.getState().secretsReady) run();
    const unsub = useSettings.subscribe((s, prev) => {
      if (s.secretsReady && !prev.secretsReady) run();
    });
    // Plain browser / keychain never answers: give up waiting after a minute and try anyway.
    const fallback = setTimeout(() => {
      if (!useSettings.getState().secretsReady) run();
    }, 60_000);
    return () => {
      unsub();
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, []);

  const s = useSettings();
  const showNotice = !s.shareNoticeSeen && s.shareResults;
  const up = useUpdater();
  const showUpdate = (up.status === "available" && up.dismissed !== up.version) || up.status === "downloading" || up.status === "installing";

  return (
    <div className="flex h-screen flex-col">
      {showUpdate && (
        <div className="flex flex-wrap items-center gap-3 border-b border-green-500/40 bg-green-500/10 px-4 py-2 text-sm">
          {up.status === "available" ? (
            <>
              <span className="text-zinc-100">
                <b>Version {up.version} is available.</b>
                {up.notes ? ` ${up.notes.split("\n")[0].slice(0, 140)}` : ""}
              </span>
              <button className="btn btn-primary" onClick={() => void up.install()}>
                Install and restart
              </button>
              <button className="btn" onClick={up.dismiss}>
                Later
              </button>
            </>
          ) : (
            <span className="text-zinc-100">
              {up.status === "installing" ? "Installing…" : `Downloading the update… ${up.progress != null ? `${Math.round(up.progress * 100)}%` : ""}`} The app
              restarts when it is done.
            </span>
          )}
        </div>
      )}
      {showNotice && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          <span className="text-zinc-200">
            <b>Community stats are on.</b> After each battle the app shares anonymous numbers (enemy troop mix, army sizes,
            result, losses) to improve suggestions for everyone. Never screenshots, names or coordinates.
          </span>
          <button className="btn" onClick={() => setView("settings")}>
            See details / turn off
          </button>
          <button className="btn" onClick={s.dismissShareNotice}>
            OK
          </button>
        </div>
      )}
      <header className="flex items-center gap-4 border-b border-border px-4 py-2">
        <h1 className="text-lg font-semibold text-accent">Grand Strategy Analyzer</h1>
        <nav className="ml-auto flex gap-2">
          <button
            className={`btn ${view === "analyzer" ? "btn-primary" : ""}`}
            onClick={() => setView("analyzer")}
          >
            Analyzer
          </button>
          <button
            className={`btn ${view === "history" ? "btn-primary" : ""}`}
            onClick={() => setView("history")}
          >
            History
          </button>
          <button
            className={`btn ${view === "knowledge" ? "btn-primary" : ""}`}
            onClick={() => setView("knowledge")}
          >
            Knowledge
          </button>
          <button
            className={`btn ${view === "settings" ? "btn-primary" : ""}`}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-4">
        {/* Both stay mounted so analysis state survives a trip to Settings. */}
        <div hidden={view !== "analyzer"}>
          <AnalyzerView />
        </div>
        <div hidden={view !== "history"}>
          <HistoryView />
        </div>
        <div hidden={view !== "knowledge"}>
          <KnowledgeView />
        </div>
        <div hidden={view !== "settings"}>
          <SettingsView />
        </div>
      </main>
    </div>
  );
}
