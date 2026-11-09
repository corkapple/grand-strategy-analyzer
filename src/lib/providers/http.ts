import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ProviderError, type ProviderId } from "./types";

const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Inside Tauri use the Rust HTTP client (no CORS); in a plain browser fall back to fetch. */
export const httpFetch: typeof fetch = (input, init) =>
  inTauri
    ? (tauriFetch as unknown as typeof fetch)(input, init)
    : fetch(input, init);

export const REQUEST_TIMEOUT_MS = 90_000;

/**
 * fetch with a hard timeout. Races the request against a timer as well as
 * aborting it, because the Tauri HTTP plugin may not reject on abort.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (signal?.aborted) throw new Error("Cancelled"); // 'abort' never fires again for an already-aborted signal
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error(`Timed out after ${timeoutMs / 1000}s with no response`));
    }, timeoutMs);
    ctl.signal.addEventListener("abort", () => reject(new Error("Cancelled")));
  });
  try {
    return await Promise.race([httpFetch(url, { ...init, signal: ctl.signal }), stop]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Rejects if `p` has not settled within `ms` (used for reading response bodies). */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out reading ${what}`)), Math.max(ms, 50));
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const networkError = (providerId: ProviderId, url: string, e: unknown) =>
  (e as Error).message === "Cancelled"
    ? new ProviderError("Cancelled.", providerId)
    : new ProviderError(`Network error contacting ${url}: ${(e as Error).message}`, providerId);

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function postJson<T>(
  providerId: ProviderId,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const left = () => deadline - Date.now();
  let res: Response;
  try {
    console.info(`[gsa] POST ${url}`);
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
      signal,
      timeoutMs,
    );
    console.info(`[gsa] ${providerId} -> HTTP ${res.status}`);
  } catch (e) {
    throw networkError(providerId, url, e);
  }
  if (!res.ok) {
    const detail = (
      await withTimeout(res.text(), Math.min(left(), 5000), "the error reply").catch(() => "")
    ).slice(0, 600);
    if (res.status === 429) {
      const wait = detail.match(/retry in ([0-9hms.]+)/i)?.[1];
      throw new ProviderError(
        `${providerId} rate limit or free quota reached (HTTP 429)` +
          (wait ? `; it says to retry in ${wait.replace(/\.$/, "").replace(/\.\d+/, "")}` : "") +
          ".",
        providerId,
        429,
      );
    }
    throw new ProviderError(`HTTP ${res.status} from ${providerId}: ${detail}`, providerId, res.status);
  }
  try {
    // The timeout above only covers the wait for headers; a stalled body must not hang the app.
    return (await withTimeout(res.json(), left(), "the reply")) as T;
  } catch (e) {
    throw new ProviderError(`Could not read the reply from ${providerId}: ${(e as Error).message}`, providerId);
  }
}

export async function getJson<T>(
  providerId: ProviderId,
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers }, undefined, timeoutMs);
  } catch (e) {
    throw networkError(providerId, url, e);
  }
  if (!res.ok) {
    throw new ProviderError(`HTTP ${res.status} from ${url}`, providerId, res.status);
  }
  try {
    return (await withTimeout(res.json(), deadline - Date.now(), "the reply")) as T;
  } catch (e) {
    throw new ProviderError(`Could not read the reply from ${url}: ${(e as Error).message}`, providerId);
  }
}

export function requireKey(
  providerId: ProviderId,
  key: string | undefined,
): string {
  if (!key?.trim()) {
    throw new ProviderError(
      "API key missing. Add it in Settings.",
      providerId,
    );
  }
  return key.trim();
}

/** GET a page as text (for fetching guides). https only. */
export async function getText(url: string, timeoutMs = 30_000): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new Error("Only https:// URLs can be fetched");
  const deadline = Date.now() + timeoutMs;
  const res = await fetchWithTimeout(url, { headers: { Accept: "text/html,*/*" } }, undefined, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await withTimeout(res.text(), deadline - Date.now(), "the page");
}
