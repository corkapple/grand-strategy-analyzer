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
  if (p.capabilities.requiresApiKey && !c.config.apiKey?.trim()) return `no API key for ${p.label}`;
  return null;
}

/** The configured fallback, if it is usable and different from the main provider. */
export function fallbackCandidates(s: {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  fallbackEnabled: boolean;
  fallbackProvider: ProviderId;
}): Candidate[] {
  if (!s.fallbackEnabled || s.fallbackProvider === s.activeProvider) return [];
  const c = { id: s.fallbackProvider, config: s.providers[s.fallbackProvider] };
  return unusable(c) ? [] : [c];
}

/**
 * Tries each candidate in order. Moves on after a retryable failure (quota, timeout, outage);
 * stops on auth or no-credit errors and when the user cancels.
 */
export async function analyzeWithFallback(chain: Candidate[], req: VisionRequest): Promise<VisionResponse> {
  const skipped: string[] = [];
  let lastError: unknown;
  for (const c of chain) {
    const why = unusable(c);
    if (why) {
      skipped.push(`${getProvider(c.id).label}: ${why}`);
      continue;
    }
    try {
      const res = await getProvider(c.id).analyze(req, c.config);
      return skipped.length || c !== chain[0]
        ? { ...res, note: `${skipped.join("; ")}${skipped.length ? "; " : ""}answered by ${getProvider(c.id).label}` }
        : res;
    } catch (e) {
      if (req.signal?.aborted) throw e;
      lastError = e;
      if (!isRetryable(e)) throw e;
      skipped.push(`${getProvider(c.id).label} failed (${(e as Error).message.split("\n")[0].slice(0, 110)})`);
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
