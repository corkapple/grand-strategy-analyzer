import { getJson, joinUrl } from "./http";

interface ORModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

/** Live list of currently free OpenRouter models that accept image input and return text. No API key needed. */
export async function listFreeVisionModels(baseUrl = "https://openrouter.ai/api/v1") {
  const data = await getJson<{ data: ORModel[] }>("openrouter", joinUrl(baseUrl, "models"), {}, 20_000);
  return data.data
    .filter(
      (m) =>
        Number(m.pricing?.prompt) === 0 &&
        Number(m.pricing?.completion) === 0 &&
        m.architecture?.input_modalities?.includes("image") &&
        (m.architecture?.output_modalities ?? ["text"]).every((o) => o === "text"),
    )
    .map((m) => ({ id: m.id, name: m.name ?? m.id }));
}

/**
 * Order free models for fallback: Gemma first (fast, no long reasoning phase), then others,
 * reasoning models last. The auto-router id itself is excluded, and at most 4 are tried.
 */
export function pickFreeModels(list: { id: string }[], max = 4): string[] {
  const rank = (id: string) => (/gemma/i.test(id) ? 0 : /reasoning|think|r1/i.test(id) ? 2 : 1);
  return list
    .map((m) => m.id)
    .filter((id) => id !== "openrouter/free" && !/^stealth\//.test(id))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, max);
}
