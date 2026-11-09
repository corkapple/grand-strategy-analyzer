import { invoke } from "@tauri-apps/api/core";
import { getJson, joinUrl, postJson } from "./http";
import { ProviderError, type LLMProvider, type ProviderConfig } from "./types";

const BASE = "http://127.0.0.1:47821";
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** First run includes logging in, then waiting for the web chat to answer. */
const ANALYZE_TIMEOUT_MS = 6 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseOf = (cfg: ProviderConfig) => cfg.baseUrl?.trim() || BASE;

async function isUp(base: string): Promise<boolean> {
  try {
    await getJson("browser", joinUrl(base, "health"), {}, 3000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes sure the bridge is listening. In the desktop app it is started
 * automatically (Rust launches the bundled Node + bridge); with a custom base
 * URL or in a plain browser it must be started manually.
 */
export async function ensureBridge(base: string): Promise<void> {
  if (await isUp(base)) return;
  if (inTauri && base === BASE) {
    try {
      await invoke("bridge_start");
    } catch (e) {
      throw new ProviderError(`Could not start the browser bridge: ${String(e)}`, "browser");
    }
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await isUp(base)) return;
    }
    throw new ProviderError(
      "The browser bridge was started but did not respond. See bridge.log in the app data folder.",
      "browser",
    );
  }
  throw new ProviderError(
    `Bridge not reachable at ${base}. Start it with \`npm run bridge\` (or reset Base URL to ${BASE} in the desktop app).`,
    "browser",
  );
}

/** Opens the chosen site in the automation browser so you can log in once. */
export async function openSiteForLogin(cfg: ProviderConfig): Promise<void> {
  const base = baseOf(cfg);
  await ensureBridge(base);
  const r = await postJson<{ ok?: boolean; error?: string }>(
    "browser",
    joinUrl(base, "open"),
    { site: cfg.extra?.site ?? "gemini" },
    {},
    undefined,
    60_000,
  );
  if (!r.ok) throw new ProviderError(r.error ?? "Could not open the site.", "browser");
}

/**
 * API-less mode. Talks to the local Playwright bridge (`bridge/server.mjs`),
 * which drives a persistent Chrome/Edge profile where the user is logged in to
 * Gemini / ChatGPT / DeepSeek web chat.
 */
export const browserBridge: LLMProvider = {
  id: "browser",
  label: "Browser Web Automation (no API key)",
  group: "no-api",
  capabilities: {
    vision: true,
    requiresApiKey: false,
    local: true,
    notes:
      "Needs Google Chrome or Microsoft Edge installed. The bridge starts automatically. Click \"Open site to log in\" once and sign in; the login is remembered. Web UIs change; selectors may need updating. Check each site's terms of service.",
  },
  defaultConfig: { baseUrl: BASE, extra: { site: "gemini" } },

  async analyze(req, cfg) {
    const site = cfg.extra?.site ?? "gemini";
    const base = baseOf(cfg);
    await ensureBridge(base);
    const data = await postJson<{ text?: string; error?: string }>(
      "browser",
      joinUrl(base, "analyze"),
      {
        site,
        systemPrompt: req.systemPrompt,
        userPrompt: req.userPrompt,
        images: req.images,
      },
      {},
      req.signal,
      ANALYZE_TIMEOUT_MS,
    );
    if (!data.text) {
      throw new ProviderError(data.error ?? "Bridge returned no text.", "browser");
    }
    return { status: "complete", text: data.text, providerId: "browser", model: site };
  },

  async testConnection(cfg) {
    const base = baseOf(cfg);
    await ensureBridge(base);
    const h = await getJson<{ ok: boolean; sites: string[] }>("browser", joinUrl(base, "health"));
    return `Bridge up. Sites: ${h.sites.join(", ")}`;
  },
};
