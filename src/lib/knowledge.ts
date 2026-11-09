import { getProvider } from "./providers";
import { analyzeWithFallback, unusable, type Candidate } from "./providers/fallback";
import { getText } from "./providers/http";
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractPrompt,
  dedupeKey,
  htmlToText,
  MAX_PAGE_CHARS,
  sha256Hex,
  verifyFacts,
  type KnowledgeEntry,
  type Source,
} from "./knowledgeCore";

export * from "./knowledgeCore";

export function dueSources(sources: Source[], intervalDays: number, now = Date.now()): Source[] {
  return sources.filter((s) => !s.lastChecked || now - s.lastChecked >= intervalDays * 864e5);
}

export type SourceOutcome =
  | { status: "unchanged"; hash: string }
  | { status: "ok"; hash: string; entries: KnowledgeEntry[]; dropped: number; fresh: number };

/** Fetches one source and, if its content changed, asks the model to extract facts. */
export async function updateSource(
  source: Source,
  chain: Candidate[],
  existing: KnowledgeEntry[],
  force = false,
): Promise<SourceOutcome> {
  const html = await getText(source.url);
  const text = htmlToText(html).slice(0, MAX_PAGE_CHARS);
  if (text.length < 300) {
    throw new Error("The page has almost no readable text (it may need JavaScript or a login)");
  }
  const hash = await sha256Hex(text);
  if (!force && hash === source.lastHash) return { status: "unchanged", hash };

  const res = await analyzeWithFallback(chain, {
    images: [],
    systemPrompt: EXTRACT_SYSTEM_PROMPT,
    userPrompt: buildExtractPrompt(source.url, text),
    temperature: 0,
  });
  const { entries, dropped } = verifyFacts(res.text, text, source);
  const seen = new Set(existing.map((e) => dedupeKey(e.sourceUrl, e.statement)));
  const fresh = entries.filter((e) => !seen.has(dedupeKey(e.sourceUrl, e.statement)));
  return { status: "ok", hash, entries: fresh, dropped, fresh: fresh.length };
}

/**
 * Providers (main first, then the fallback) that can answer a text-only extraction on their own,
 * plus a message when none can.
 */
export function extractionChain(
  main: Candidate,
  fallbacks: Candidate[],
): { chain: Candidate[]; problem: string | null } {
  const chain = [main, ...fallbacks].filter((c) => unusable(c) === null);
  if (chain.length) return { chain, problem: null };
  const label = getProvider(main.id).label;
  const why = unusable(main) ?? "unavailable";
  return {
    chain,
    problem:
      main.id === "browser" || main.id === "clipboard"
        ? "Pick an API provider (Gemini or OpenRouter free) in Settings to update knowledge."
        : `Cannot update knowledge: ${label}: ${why}. Add the key in Settings.`,
  };
}
