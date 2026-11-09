import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeWithFallback, fallbackCandidates } from "./fallback";
import { defaultProviderConfigs } from "./registry";

const req = { images: [], systemPrompt: "s", userPrompt: "u" };
const GEMINI = { id: "gemini" as const, config: { apiKey: "g", model: "gemini-2.5-flash" } };
const OPENROUTER = { id: "openrouter" as const, config: { apiKey: "o", model: "google/gemma-4-31b-it:free" } };

function net(handlers: { gemini?: () => Response; openrouter?: () => Response }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const host = url.includes("generativelanguage") ? "gemini" : "openrouter";
      calls.push(host);
      return (handlers[host] ?? (() => new Response("{}", { status: 500 })))();
    }),
  );
  return calls;
}
const geminiOk = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"from":"gemini"}' }] } }] }), { status: 200 });
const orOk = () =>
  new Response(JSON.stringify({ model: "google/gemma-4-31b-it:free", choices: [{ message: { content: '{"from":"or"}' } }] }), {
    status: 200,
  });
const quota = () =>
  new Response('{"error":{"message":"Quota exceeded. Please retry in 9h59m41.38s."}}', { status: 429 });

afterEach(() => vi.unstubAllGlobals());

describe("analyzeWithFallback", () => {
  it("uses the main provider when it works and adds no note", async () => {
    const calls = net({ gemini: geminiOk });
    const res = await analyzeWithFallback([GEMINI, OPENROUTER], req);
    expect(res.text).toContain("gemini");
    expect(res.note).toBeUndefined();
    expect(calls).toEqual(["gemini"]);
  });

  it("falls back to OpenRouter when Gemini's free quota is used up, and says why", async () => {
    const calls = net({ gemini: quota, openrouter: orOk });
    const res = await analyzeWithFallback([GEMINI, OPENROUTER], req);
    expect(res.text).toContain("or");
    expect(calls).toEqual(["gemini", "openrouter"]);
    expect(res.note).toMatch(/Gemini.*failed.*429.*retry in 9h59m41s.*answered by OpenRouter/);
  });

  it("does not fall back on a bad key (401) or when the user cancelled", async () => {
    let calls = net({ gemini: () => new Response("{}", { status: 401 }), openrouter: orOk });
    await expect(analyzeWithFallback([GEMINI, OPENROUTER], req)).rejects.toThrow(/401/);
    expect(calls).toEqual(["gemini"]);

    const ctl = new AbortController();
    ctl.abort();
    calls = net({ gemini: quota, openrouter: orOk });
    await expect(analyzeWithFallback([GEMINI, OPENROUTER], { ...req, signal: ctl.signal })).rejects.toThrow();
    expect(calls).not.toContain("openrouter");
  });

  it("skips a provider without a key and uses the next", async () => {
    const calls = net({ openrouter: orOk });
    const res = await analyzeWithFallback([{ id: "gemini", config: {} }, OPENROUTER], req);
    expect(calls).toEqual(["openrouter"]);
    expect(res.note).toMatch(/no API key/);
  });

  it("reports every failure when all providers fail", async () => {
    net({ gemini: quota, openrouter: () => new Response("{}", { status: 503 }) });
    await expect(analyzeWithFallback([GEMINI, OPENROUTER], req)).rejects.toThrow(/Every provider failed[\s\S]*Gemini[\s\S]*OpenRouter/);
  });
});

describe("fallbackCandidates", () => {
  const base = { activeProvider: "gemini" as const, fallbackEnabled: true, fallbackProvider: "openrouter" as const };
  const withKeys = (o: string) => {
    const p = defaultProviderConfigs();
    p.openrouter = { ...p.openrouter, apiKey: o };
    return p;
  };
  it("returns the fallback only when enabled, keyed, and different from the main provider", () => {
    expect(fallbackCandidates({ ...base, providers: withKeys("k") })).toHaveLength(1);
    expect(fallbackCandidates({ ...base, providers: withKeys("") })).toHaveLength(0);
    expect(fallbackCandidates({ ...base, providers: withKeys("k"), fallbackEnabled: false })).toHaveLength(0);
    expect(fallbackCandidates({ ...base, providers: withKeys("k"), activeProvider: "openrouter" })).toHaveLength(0);
  });
});
