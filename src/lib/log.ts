import { invoke } from "@tauri-apps/api/core";
import { APP_VERSION } from "./community/config";

/**
 * A diagnostic log that stays on this computer. It records what the app did (which provider answered, what
 * failed and why, what was repaired), so a problem can be diagnosed from a few lines of text instead of
 * screenshots. It never records API keys, screenshots, coordinates, server numbers or player names.
 */

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export type Level = "info" | "warn" | "error";
export interface LogEntry {
  t: number;
  level: Level;
  event: string;
  run?: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;
let entries: LogEntry[] = [];
let enabled = true;
let currentRun: string | undefined;

export const setLogEnabled = (v: boolean) => {
  enabled = v;
};

/** Starts a new "run" (one analysis); later entries carry its id so they can be copied together. */
export function newRun(): string {
  currentRun = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return currentRun;
}

// ---- keeping secrets and identifying details out ----------------------------------------------------------

const SECRET_KEYS = /^(apikey|api_key|key|token|secret|authorization|password|base64|image|images|imagebase64|prompt|systemprompt|userprompt|raw)$/i;
const IDENTIFYING_KEYS = /^(location|coords?|server|x|y|name|player|playername|alliance)$/i;

function cleanString(s: string): string {
  return s
    .replace(/S\s*:\s*\d+\s*X\s*:\s*\d+\s*Y\s*:?\s*\d+/gi, "S:* X:* Y:*")
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s"']+/gi, "$1***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\b(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "***")
    .replace(/[A-Za-z0-9+/=]{200,}/g, "<data>")
    .slice(0, 400);
}

/** A copy of `v` that is safe to write down: no secrets, coordinates or long blobs. Exported for tests. */
export function sanitize(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return cleanString(v);
  if (v instanceof Error) return cleanString(v.message);
  if (depth > 4) return "<nested>";
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => sanitize(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
      if (IDENTIFYING_KEYS.test(k)) continue;
      // A secret-looking field is dropped unless it is just a count or a flag (images: 2).
      if (SECRET_KEYS.test(k) && typeof val !== "number" && typeof val !== "boolean") continue;
      out[k] = sanitize(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

export function log(event: string, data?: unknown, level: Level = "info") {
  if (!enabled) return;
  const e: LogEntry = { t: Date.now(), level, event, run: currentRun, data: data === undefined ? undefined : sanitize(data) };
  entries.push(e);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  if (inTauri) void invoke("log_append", { line: JSON.stringify(e) }).catch(() => undefined);
}

// ---- reading it back ---------------------------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, "0");

function compact(data: unknown): string {
  if (data === undefined) return "";
  if (typeof data !== "object" || data === null) return String(data);
  return Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}

export function formatEntry(e: LogEntry): string {
  const d = new Date(e.t);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  const tag = e.level === "info" ? "" : `${e.level.toUpperCase()} `;
  return `${time} ${e.run ? `[${e.run}] ` : ""}${tag}${e.event} ${compact(e.data)}`.trimEnd();
}

export function header(extra = ""): string {
  const platform = typeof navigator === "undefined" ? "?" : /Mac/i.test(navigator.userAgent) ? "macOS" : /Win/i.test(navigator.userAgent) ? "Windows" : "other";
  return `Grand Strategy Analyzer ${APP_VERSION} on ${platform}${extra ? ` | ${extra}` : ""}`;
}

/** Text to paste to someone helping: the header plus the entries of one run (or the latest ones). */
export function debugReport(opts: { run?: string; last?: number } = {}): string {
  const picked = opts.run ? entries.filter((e) => e.run === opts.run) : entries.slice(-(opts.last ?? 80));
  return [header(), ...picked.map(formatEntry)].join("\n");
}

/** The current run id (for the "Copy debug info" button). */
export const lastRun = () => currentRun;

/** Everything logged since the app started (and, in the desktop app, the saved file's recent end). */
export async function recentLogText(maxBytes = 60_000): Promise<string> {
  if (inTauri) {
    try {
      const tail = await invoke<string>("log_tail", { maxBytes });
      const lines = tail
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return formatEntry(JSON.parse(l) as LogEntry);
          } catch {
            return l;
          }
        });
      return [header(), ...lines.slice(-250)].join("\n");
    } catch {
      /* fall through to memory */
    }
  }
  return debugReport({ last: 250 });
}

export const clearMemoryLog = () => {
  entries = [];
};

/** Test helper. */
export const _entries = () => entries;
