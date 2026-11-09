import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeWithFallback, fallbackCandidates, retry } from "./fallback";
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
    expect(res.note).toMatch(/Gemini.*429.*retry in 9h59m41s[\s\S]*answered by OpenRouter/);
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
    const off = { meshGuides: false };
    expect(fallbackCandidates({ ...base, ...off, providers: withKeys("k") })).toHaveLength(1);
    expect(fallbackCandidates({ ...base, ...off, providers: withKeys("") })).toHaveLength(0);
    expect(fallbackCandidates({ ...base, ...off, providers: withKeys("k"), fallbackEnabled: false })).toHaveLength(0);
    expect(fallbackCandidates({ ...base, ...off, providers: withKeys("k"), activeProvider: "openrouter" })).toHaveLength(0);
  });
});

describe("free-provider chain and Mesh", () => {
  const base = () => {
    const providers = defaultProviderConfigs();
    return {
      activeProvider: "gemini" as const,
      providers,
      fallbackEnabled: true,
      fallbackProvider: "openrouter" as const,
    };
  };
  const withKeys = (keys: Record<string, string>) => {
    const s = base();
    for (const [id, k] of Object.entries(keys)) (s.providers as Record<string, { apiKey?: string }>)[id] = { ...(s.providers as Record<string, object>)[id], apiKey: k };
    return s;
  };
  const ids = (s: ReturnType<typeof base>, extra: object = {}) => fallbackCandidates({ ...s, ...extra }).map((c) => c.id);

  it("tries the chosen second provider, then every other free provider that has a key, then Mesh", () => {
    const s = withKeys({ openrouter: "o", groq: "g", mistral: "m", anthropic: "paid", openai: "paid" });
    expect(ids(s)).toEqual(["openrouter", "groq", "mesh"]); // Mistral's API is not free, so it is never added on its own
  });
  it("never adds paid providers on its own, and skips ones without a key", () => {
    const s = withKeys({ openrouter: "o", openai: "k", anthropic: "k", deepseek: "k" });
    expect(ids(s)).toEqual(["openrouter", "mesh"]);
  });
  it("can be limited to the single chosen provider, and Mesh can be switched off", () => {
    const s = withKeys({ openrouter: "o", groq: "g" });
    expect(ids(s, { autoFallback: false, meshGuides: false })).toEqual(["openrouter"]);
  });
  it("still offers Mesh for guide text when no second provider is configured", () => {
    expect(ids(base())).toEqual(["mesh"]);
  });

  const mesh = { id: "mesh" as const, config: {} };
  const meshReply = (content: string | null, reasoning?: string) =>
    new Response(JSON.stringify({ model: "m", choices: [{ message: { content, reasoning_content: reasoning } }] }), { status: 200 });

  it("skips the text-only Mesh quietly when screenshots are involved", async () => {
    const calls = net({ gemini: quota, openrouter: orOk });
    const img = { ...req, images: [{ base64: "AAAA", mimeType: "image/jpeg" }] };
    const res = await analyzeWithFallback([GEMINI, mesh, OPENROUTER], img);
    expect(res.text).toContain("or");
    expect(res.note).not.toMatch(/mesh/i);
    expect(calls).toEqual(["gemini", "openrouter"]);
  });
  it("answers text-only requests through Mesh and sends no key", async () => {
    const seen: { url: string; headers: unknown; body: { messages: { content: unknown }[]; max_tokens?: number } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({ url, headers: init?.headers, body: JSON.parse(String(init?.body)) });
        return meshReply('{"facts":[]}');
      }),
    );
    const res = await analyzeWithFallback([mesh], req);
    expect(res.text).toBe('{"facts":[]}');
    expect(seen[0].url).toBe("https://public.meshllm.cloud/v1/chat/completions");
    expect(JSON.stringify(seen[0].headers)).not.toMatch(/authorization/i);
    expect(typeof seen[0].body.messages[1].content).toBe("string"); // plain text, no image parts
    expect(seen[0].body.max_tokens).toBeGreaterThan(1000); // room for a reasoning model to think and answer
  });
  it("explains when a reasoning model spends its whole budget thinking", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => meshReply(null, "Okay, the user wants...")));
    await expect(analyzeWithFallback([mesh], req)).rejects.toThrow(/thinking/);
  });
});

describe("a provider whose default model was retired", () => {
  const body = (model: string) => ({ model, choices: [{ message: { content: '{"ok":true}' } }] });
  it("looks up a current vision model and uses it (Groq pulled Llama 4; a successor to the default can be found the same way)", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "whisper-large-v3" }, { id: "llama-3.3-70b-versatile" }, { id: "qwen/qwen3.9-30b" }] }), { status: 200 });
        }
        const model = JSON.parse(String(init?.body)).model as string;
        asked.push(model);
        return model === "qwen/qwen3.8-27b"
          ? new Response('{"error":{"message":"The model `qwen/qwen3.8-27b` does not exist"}}', { status: 404 })
          : new Response(JSON.stringify(body(model)), { status: 200 });
      }),
    );
    const { getProvider } = await import("./registry");
    const res = await getProvider("groq").analyze(
      { images: [{ base64: "AAAA", mimeType: "image/jpeg" }], systemPrompt: "s", userPrompt: "u" },
      { apiKey: "k", model: getProvider("groq").defaultConfig.model },
    );
    expect(asked).toEqual(["qwen/qwen3.8-27b", "qwen/qwen3.9-30b"]);
    expect(res.note).toMatch(/no longer offered/);
    // The next request goes straight to the model that worked.
    asked.length = 0;
    await getProvider("groq").analyze({ images: [{ base64: "AAAA", mimeType: "image/jpeg" }], systemPrompt: "s", userPrompt: "u" }, { apiKey: "k", model: getProvider("groq").defaultConfig.model });
    expect(asked).toEqual(["qwen/qwen3.9-30b"]);
  });
  it("leaves a model the user chose alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"model does not exist"}}', { status: 404 })));
    const { getProvider } = await import("./registry");
    await expect(
      getProvider("groq").analyze({ images: [], systemPrompt: "s", userPrompt: "u" }, { apiKey: "k", model: "my-own-model" }),
    ).rejects.toThrow(/does not exist|unavailable/);
  });
});

describe("Groq's image limit", () => {
  it("hands over to the next provider instead of failing when more than 3 screenshots are sent", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (calls.push(url), new Response("{}", { status: 500 }))));
    const { getProvider } = await import("./registry");
    const img = { base64: "AAAA", mimeType: "image/jpeg" };
    await expect(getProvider("groq").analyze({ images: [img, img, img, img], systemPrompt: "s", userPrompt: "u" }, { apiKey: "k" })).rejects.toThrow(/at most 3 images/);
    expect(calls).toEqual([]); // never even sent
  });
});

describe("an overloaded provider (HTTP 503)", () => {
  const busy = () => new Response("{}", { status: 503 });
  it("is retried once and used when it answers the second time", async () => {
    retry.delayMs = 0;
    let n = 0;
    const calls = net({ gemini: () => (++n === 1 ? busy() : geminiOk()), openrouter: orOk });
    const res = await analyzeWithFallback([GEMINI, OPENROUTER], req);
    expect(res.text).toContain("gemini");
    expect(calls).toEqual(["gemini", "gemini"]);
  });
  it("moves on to the next provider when it is still busy, with a short readable reason", async () => {
    retry.delayMs = 0;
    const calls = net({ gemini: busy, openrouter: orOk });
    const res = await analyzeWithFallback([GEMINI, OPENROUTER], req);
    expect(calls).toEqual(["gemini", "gemini", "openrouter"]);
    expect(res.note).toMatch(/temporarily unavailable or overloaded \(HTTP 503\)/);
    expect(res.note).not.toMatch(/\{\}/); // no raw empty JSON
    expect(res.note?.split("\n").length).toBeGreaterThan(1); // one provider per line
  });
});

describe("plainDetail", () => {
  it("pulls the message out of a provider's JSON error and ignores empty bodies", async () => {
    const { plainDetail } = await import("./http");
    expect(plainDetail('{"error":{"message":"The model `x` does not exist","type":"invalid_request_error"}}')).toBe("The model `x` does not exist");
    expect(plainDetail("{}")).toBe("");
    expect(plainDetail("plain text")).toBe("plain text");
  });
});
