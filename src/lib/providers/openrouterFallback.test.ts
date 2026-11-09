import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "./registry";
import { resetFreeModelCooldown } from "./openaiCompatible";

const FREE = (id: string) => ({
  id,
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
});
const req = { images: [{ base64: "AAAA", mimeType: "image/jpeg" }], systemPrompt: "s", userPrompt: "u" };
const cfg = { apiKey: "k", model: "openrouter/free" };

/** Fake OpenRouter: model list plus per-model chat behaviour. */
function fakeNetwork(behaviour: Record<string, () => { status: number; body: unknown }>) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({ data: [FREE("openrouter/free"), FREE("nvidia/nemotron-3.5-super-vl:free"), FREE("google/gemma-4-31b-it:free")] }),
          { status: 200 },
        );
      }
      const model = JSON.parse(String(init?.body)).model as string;
      asked.push(model);
      const r = (behaviour[model] ?? (() => ({ status: 500, body: { error: "x" } })))();
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
  return asked;
}
const ok = (model: string) => () => ({
  status: 200,
  body: { model, choices: [{ message: { content: '{"ok":true}' } }] },
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetFreeModelCooldown();
});

describe("OpenRouter free-tier fallback", () => {
  it("tries Gemma first and moves on when a model fails", async () => {
    const asked = fakeNetwork({
      "google/gemma-4-31b-it:free": () => ({ status: 503, body: { error: "busy" } }),
      "nvidia/nemotron-3.5-super-vl:free": ok("nvidia/nemotron-3.5-super-vl:free"),
    });
    const res = await getProvider("openrouter").analyze(req, cfg);
    expect(asked).toEqual(["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free"]);
    expect(res.model).toBe("nvidia/nemotron-3.5-super-vl:free");
    expect(res.text).toContain("ok");
  });

  it("stops at the first success", async () => {
    const asked = fakeNetwork({ "google/gemma-4-31b-it:free": ok("google/gemma-4-31b-it:free") });
    await getProvider("openrouter").analyze(req, cfg);
    expect(asked).toEqual(["google/gemma-4-31b-it:free"]);
  });

  it("does not keep trying after a no-credit or auth error", async () => {
    const asked = fakeNetwork({ "google/gemma-4-31b-it:free": () => ({ status: 402, body: { error: "credit" } }) });
    await expect(getProvider("openrouter").analyze(req, cfg)).rejects.toThrow(/no credit/);
    expect(asked).toHaveLength(1);
  });

  it("reports every failure when all models fail", async () => {
    fakeNetwork({});
    await expect(getProvider("openrouter").analyze(req, cfg)).rejects.toThrow(/All free models failed[\s\S]*gemma-4-31b/);
  });

  it("uses a chosen model directly with no fallback", async () => {
    const asked = fakeNetwork({ "google/gemma-4-26b-a4b-it:free": ok("google/gemma-4-26b-a4b-it:free") });
    await getProvider("openrouter").analyze(req, { ...cfg, model: "google/gemma-4-26b-a4b-it:free" });
    expect(asked).toEqual(["google/gemma-4-26b-a4b-it:free"]);
  });

  it("tries a model that just failed last on the next request", async () => {
    const asked = fakeNetwork({
      "google/gemma-4-31b-it:free": () => ({ status: 429, body: { error: "limit" } }),
      "nvidia/nemotron-3.5-super-vl:free": ok("nvidia/nemotron-3.5-super-vl:free"),
    });
    await getProvider("openrouter").analyze(req, cfg);
    asked.length = 0;
    await getProvider("openrouter").analyze(req, cfg);
    expect(asked).toEqual(["nvidia/nemotron-3.5-super-vl:free"]);
  });
});
