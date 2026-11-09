import { log } from "../log";
import { getProvider } from "./registry";
import { ProviderError, type ProviderConfig, type ProviderId, type VisionRequest, type VisionResponse } from "./types";

export interface Candidate {
  id: ProviderId;
  config: ProviderConfig;
}

/** Quota, rate limits, outages, timeouts and missing keys are worth trying the next provider for. */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false;
  return !(e.status === 401 || e.status === 402 || e.status === 403);
}

/** Why a candidate cannot be used at all (null = usable). */
export function unusable(c: Candidate): string | null {
  if (c.id === "browser" || c.id === "clipboard") return "needs manual steps";
  const p = getProvider(c.id);
  if (c.id === "puter" && !c.config.extra?.signedIn) return "not signed in to Puter (Settings)";
  if (p.capabilities.requiresApiKey && !c.config.apiKey?.trim()) return `no API key for ${p.label}`;
  return null;
}

/**
 * Providers with a free tier. After the chosen second provider, any of these that has a key is tried
 * too, so one provider running out does not stop the app. Paid ones are never added automatically.
 */
export const FREE_TIER: ProviderId[] = ["gemini", "openrouter", "groq", "github"];

/**
 * Fallbacks, in order: the chosen second provider, then your other free providers that have a key,
 * then (for text jobs such as reading guides) the keyless Mesh network. Mesh is skipped
 * automatically whenever screenshots are involved.
 */
export function fallbackCandidates(s: {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  fallbackEnabled: boolean;
  fallbackProvider: ProviderId;
  /** Also try every other free provider that has a key (default on). */
  autoFallback?: boolean;
  /** Use the public Mesh network for reading public guide text (default on). */
  meshGuides?: boolean;
}): Candidate[] {
  const out: Candidate[] = [];
  const add = (id: ProviderId) => {
    if (id === s.activeProvider || out.some((c) => c.id === id)) return;
    const c = { id, config: s.providers[id] ?? {} };
    if (!unusable(c)) out.push(c);
  };
  if (s.fallbackEnabled) {
    add(s.fallbackProvider);
    if (s.autoFallback !== false) FREE_TIER.forEach(add);
    add("puter"); // no key: used once you have signed in to Puter
  }
  if (s.meshGuides !== false) add("mesh");
  return out;
}

/**
 * Tries each candidate in order. Moves on after a retryable failure (quota, timeout, outage);
 * stops on auth or no-credit errors and when the user cancels.
 */
/** Wait before the single retry of an overloaded provider (tests set this to 0). */
export const retry = { delayMs: 2000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isOverload = (e: unknown) => e instanceof ProviderError && (e.status === 502 || e.status === 503 || e.status === 504);
/** One line, without the raw JSON some providers send. */
const brief = (e: unknown) => (e as Error).message.split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 320);

export async function analyzeWithFallback(chain: Candidate[], req: VisionRequest): Promise<VisionResponse> {
  const skipped: string[] = [];
  let lastError: unknown;
  for (const c of chain) {
    // A text-only provider cannot read screenshots; skip it quietly for those requests.
    if (req.images.length && getProvider(c.id).capabilities.textOnly) continue;
    if (!req.images.length && getProvider(c.id).capabilities.imageOnly) continue;
    const why = unusable(c);
    if (why) {
      skipped.push(`${getProvider(c.id).label}: ${why}`);
      log("provider.skip", { provider: c.id, why });
      continue;
    }
    const started = Date.now();
    log("provider.try", { provider: c.id, strict: c.config.extra?.strict, images: req.images.length });
    try {
      let res: VisionResponse;
      try {
        res = await getProvider(c.id).analyze(req, c.config);
      } catch (first) {
        // A busy provider (503) usually answers a moment later.
        if (!isOverload(first) || req.signal?.aborted) throw first;
        log("provider.retry", { provider: c.id, why: "overloaded (5xx)" });
        await sleep(retry.delayMs);
        res = await getProvider(c.id).analyze(req, c.config);
      }
      log("provider.ok", { provider: c.id, model: res.model, ms: Date.now() - started, note: res.note });
      return skipped.length || c !== chain[0]
        ? { ...res, note: [...skipped, `answered by ${getProvider(c.id).label}`, res.note].filter(Boolean).join("\n") }
        : res;
    } catch (e) {
      if (req.signal?.aborted) throw e;
      lastError = e;
      log("provider.fail", { provider: c.id, ms: Date.now() - started, status: (e as { status?: number }).status, message: brief(e), retryable: isRetryable(e) }, "warn");
      if (!isRetryable(e)) throw e;
      skipped.push(`${getProvider(c.id).label}: ${brief(e)}`);
    }
  }
  if (lastError) {
    const detail = skipped.join("\n- ");
    throw new ProviderError(
      chain.length > 1 ? `Every provider failed:\n- ${detail}` : (lastError as Error).message,
      undefined,
      (lastError as ProviderError).status,
    );
  }
  throw new ProviderError(`No usable provider. ${skipped.join("; ")}`);
}
