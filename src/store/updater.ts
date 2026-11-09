import { create } from "zustand";
import { APP_VERSION } from "@/lib/community/config";
import { useSettings } from "@/store/settings";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Status = "idle" | "checking" | "uptodate" | "available" | "downloading" | "installing" | "error";

interface UpdaterState {
  status: Status;
  version: string | null;
  notes: string | null;
  /** 0..1 while downloading, null when the size is unknown. */
  progress: number | null;
  error: string | null;
  /** The user closed the banner for this version. */
  dismissed: string | null;
  /** Asks the update server whether a newer version exists. Quiet on failure unless `manual`. */
  check: (manual?: boolean) => Promise<void>;
  /** Downloads, verifies and installs the update, then restarts the app. */
  install: () => Promise<void>;
  dismiss: () => void;
}

// The plugin's Update object: kept outside the store because it is not plain data.
let pending: import("@tauri-apps/plugin-updater").Update | null = null;

export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
  dismissed: null,

  check: async (manual = false) => {
    if (!inTauri || ["checking", "downloading", "installing"].includes(get().status)) return;
    set({ status: "checking", error: null });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        pending = update;
        set({ status: "available", version: update.version, notes: update.body ?? null });
      } else {
        pending = null;
        set({ status: "uptodate", version: null });
      }
    } catch (e) {
      // An offline computer or an unreachable server is normal; only say so when the user asked.
      set({ status: manual ? "error" : "idle", error: manual ? friendly(e) : null });
    }
  },

  install: async () => {
    if (!pending) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      let total = 0;
      let done = 0;
      await pending.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          set({ progress: total ? Math.min(1, done / total) : null });
        }
        if (ev.event === "Finished") set({ status: "installing", progress: 1 });
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      set({ status: "error", error: friendly(e), progress: null });
    }
  },

  dismiss: () => set({ dismissed: get().version }),
}));

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/signature/i.test(m)) return "The update's signature did not match, so it was not installed.";
  if (/network|fetch|resolve|connect|timed out|dns/i.test(m)) return "Could not reach the update server. Check your internet connection.";
  return m.slice(0, 200);
}

/** Checks a few seconds after start, then every 6 hours, if the user allows it. */
export function startUpdateChecks() {
  if (!inTauri) return () => {};
  const run = () => {
    if (useSettings.getState().checkUpdates) void useUpdater.getState().check(false);
  };
  const first = setTimeout(run, 8_000);
  const every = setInterval(run, 6 * 3600_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

export const CURRENT_VERSION = APP_VERSION;
