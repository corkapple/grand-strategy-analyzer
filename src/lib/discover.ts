import { htmlToText } from "./knowledge";
import { getText, joinUrl, postJson, requireKey } from "./providers/http";
import type { ProviderConfig } from "./providers/types";

/**
 * Finds new guide pages with Gemini's built-in Google Search tool.
 *
 * Safeguards: a suggested page must (1) be on a site the search actually returned,
 * (2) be a public https address, and (3) load and mention the game. Suggestions are
 * only suggestions; the user adds them to the source list.
 */

export interface Suggestion {
  url: string;
  title: string;
  chars: number;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const DISCOVER_PROMPT = `Use Google Search to find current, reputable community guides for the mobile game "The Grand Mafia" about combat: troop counters (Bruisers/Gangsters, Hitmen/Shooters, Bikers, Mortar Cars), formations (Square and Wedge), attack and rally strategy, traps and walls, and buffs.
Reply with one result per line in the form: URL | short title
List at most 8 pages. Only list pages you actually found in the search results. No other text.`;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Public https page only: no credentials, custom ports, localhost, private names or IP literals. */
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  if (/\.(local|internal|lan|home|corp|localdomain)$/.test(h)) return false;
  return true;
}

export function extractUrls(text: string): string[] {
  const found = text.match(/https:\/\/[^\s|)<>\]"']+/g) ?? [];
  const cleaned = found.map((u) => u.replace(/[.,;:!?]+$/, ""));
  return [...new Set(cleaned)];
}

/** True when the URL's site is one of the sites the search grounding returned. */
export function hostMatchesGrounding(url: string, groundingTitles: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return groundingTitles.some((t) => {
    const d = t.toLowerCase().replace(/^www\./, "").trim();
    return d.length > 3 && (host === d || host.endsWith(`.${d}`) || d.includes(host));
  });
}

export function pageTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? htmlToText(m[1]) : "";
  return (t || fallback).slice(0, 120);
}

export const mentionsGame = (text: string) => /grand\s*mafia/i.test(text);

// ---------------------------------------------------------------------------
// Search + verification
// ---------------------------------------------------------------------------

interface SearchResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
}

export async function searchGuides(cfg: ProviderConfig, signal?: AbortSignal) {
  const key = requireKey("gemini", cfg.apiKey);
  const model = cfg.model?.trim() || "gemini-2.5-flash";
  const data = await postJson<SearchResponse>(
    "gemini",
    joinUrl(cfg.baseUrl?.trim() || BASE, `models/${model}:generateContent`),
    {
      contents: [{ role: "user", parts: [{ text: DISCOVER_PROMPT }] }],
      // Structured JSON output cannot be combined with the search tool, so the reply is plain text.
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0 },
    },
    { "x-goog-api-key": key },
    signal,
    120_000,
  );
  const cand = data.candidates?.[0];
  return {
    text: cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
    groundingTitles: (cand?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web?.title ?? "").filter(Boolean),
  };
}

export interface DiscoverResult {
  suggestions: Suggestion[];
  /** Candidates considered and why some were skipped. */
  notes: string[];
}

export async function discoverGuides(
  cfg: ProviderConfig,
  existingUrls: string[],
  signal?: AbortSignal,
): Promise<DiscoverResult> {
  const { text, groundingTitles } = await searchGuides(cfg, signal);
  const notes: string[] = [];
  if (groundingTitles.length === 0) {
    return { suggestions: [], notes: ["The search returned no verifiable sources, so nothing was suggested."] };
  }
  const known = new Set(existingUrls.map((u) => u.replace(/[#?].*$/, "")));
  const out: Suggestion[] = [];
  for (const url of extractUrls(text).slice(0, 8)) {
    if (known.has(url.replace(/[#?].*$/, ""))) continue;
    if (!isSafePublicUrl(url)) {
      notes.push(`Skipped (not a public https page): ${url}`);
      continue;
    }
    if (!hostMatchesGrounding(url, groundingTitles)) {
      notes.push(`Skipped (not among the search results' sites): ${url}`);
      continue;
    }
    try {
      const html = await getText(url, 20_000);
      const body = htmlToText(html);
      if (body.length < 300 || !mentionsGame(body)) {
        notes.push(`Skipped (page does not look like a Grand Mafia guide): ${url}`);
        continue;
      }
      out.push({ url, title: pageTitle(html, new URL(url).hostname), chars: body.length });
    } catch (e) {
      notes.push(`Skipped (could not load): ${url}`);
    }
  }
  return { suggestions: out, notes };
}
