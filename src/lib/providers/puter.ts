import { log } from "../log";
import { ProviderError, type ImageInput, type LLMProvider, type ProviderConfig } from "./types";

/**
 * Puter (puter.com): AI models with no API key. You sign in once with a free Puter account, and that account (not
 * the app, not you as the developer) pays for the use from its own free monthly allowance ("user pays").
 * Screenshots go to Puter and the model's vendor, so it is a fallback, never the first choice.
 */
const SCRIPT = "https://js.puter.com/v2/";
export const PUTER_DEFAULT_MODEL = "google/gemini-3.6-flash";
const TIMEOUT_MS = 120_000;

interface PuterApi {
  auth: { signIn: () => Promise<unknown>; isSignedIn: () => boolean };
  ai: { chat: (...args: unknown[]) => Promise<unknown> };
}
declare global {
  interface Window {
    puter?: PuterApi;
  }
}

let loading: Promise<PuterApi> | null = null;
/** Loads Puter's script on first use (nothing is fetched from Puter until the user opts in). */
export function loadPuter(): Promise<PuterApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("Puter needs a browser window"));
  if (window.puter) return Promise.resolve(window.puter);
  loading ??= new Promise<PuterApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.puter ? resolve(window.puter) : reject(new Error("Puter loaded but is not available")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Could not load Puter (offline, or blocked by an extension)"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens Puter's sign-in window. Must be called from a click. */
export async function signInToPuter(): Promise<boolean> {
  const puter = await loadPuter();
  await puter.auth.signIn();
  return puter.auth.isSignedIn();
}

/** The reply text, whatever shape the model's reply came in (a string, or a list of text blocks). */
export function puterText(r: unknown): string {
  const c = (r as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : ((b as { text?: string })?.text ?? ""))).join("");
  return typeof r === "string" ? r : "";
}

const dataUrl = (i: ImageInput) => `data:${i.mimeType};base64,${i.base64}`;
function toFile(i: ImageInput, n: number): File {
  const bin = atob(i.base64);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new File([bytes], i.name || `screenshot-${n + 1}.png`, { type: i.mimeType });
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${ms / 1000}s`)), ms))]);

export const puter: LLMProvider = {
  id: "puter",
  label: "Puter (free account, no API key)",
  group: "no-api",
  capabilities: {
    vision: true,
    requiresApiKey: false,
    local: false,
    notes:
      "No API key: sign in once with a free Puter account (button below). Your Puter account pays from its own free monthly allowance. Your screenshots are sent to Puter and the model's vendor.",
  },
  defaultConfig: { model: PUTER_DEFAULT_MODEL, extra: { signedIn: "" } },

  async analyze(req, cfg: ProviderConfig) {
    const model = cfg.model?.trim() || PUTER_DEFAULT_MODEL;
    let api: PuterApi;
    try {
      api = await loadPuter();
    } catch (e) {
      throw new ProviderError((e as Error).message, "puter");
    }
    if (!api.auth.isSignedIn()) throw new ProviderError("Not signed in to Puter. Sign in under Settings → Puter.", "puter");
    const options = { model, temperature: req.temperature ?? 0, max_tokens: 6000, normalize: true };
    const prompt = `${req.systemPrompt}\n\n${req.userPrompt}`;
    const messages = [
      { role: "system", content: req.systemPrompt },
      {
        role: "user",
        content: [{ type: "text", text: req.userPrompt }, ...req.images.map((i) => ({ type: "image_url", image_url: { url: dataUrl(i) } }))],
      },
    ];
    let reply: unknown;
    try {
      // Standard chat-message form first (several images, data: URLs)...
      reply = await withTimeout(api.ai.chat(messages, false, options), TIMEOUT_MS);
    } catch (first) {
      log("puter.retry", { why: String((first as Error)?.message ?? first).slice(0, 120) });
      try {
        // ...then the documented prompt + files form.
        reply = await withTimeout(api.ai.chat(prompt, req.images.map(toFile), false, options), TIMEOUT_MS);
      } catch (second) {
        const m = String((second as { message?: string; error?: { message?: string } })?.message ?? (second as { error?: { message?: string } })?.error?.message ?? second);
        throw new ProviderError(`Puter: ${/insufficient|402/i.test(m) ? "your free allowance is used up" : m}`.slice(0, 300), "puter");
      }
    }
    const text = puterText(reply);
    if (!text.trim()) throw new ProviderError("Puter returned an empty reply.", "puter");
    return { status: "complete", text, providerId: "puter", model };
  },
};
