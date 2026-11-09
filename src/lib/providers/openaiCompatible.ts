import { getJson, joinUrl, postJson, requireKey } from "./http";
import { listFreeVisionModels, pickFreeModels } from "./openrouterModels";
import {
  ProviderError,
  type LLMProvider,
  type ProviderCapabilities,
  type ProviderConfig,
  type ProviderId,
  type VisionRequest,
  type VisionResponse,
} from "./types";

interface ChatCompletion {
  /** The model that actually answered (OpenRouter's auto-router reports the one it picked). */
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAICompatibleSpec {
  id: ProviderId;
  label: string;
  group: LLMProvider["group"];
  defaultBaseUrl: string;
  defaultModel: string;
  capabilities: ProviderCapabilities;
  /** Request `response_format: json_object` (not every server supports it). */
  jsonMode?: boolean;
  extraHeaders?: Record<string, string>;
}

/**
 * One implementation for OpenAI, OpenRouter, DeepSeek, LM Studio, LocalAI and
 * anything else that speaks `POST {base}/chat/completions`.
 */
const cooldown = new Map<string, number>();
/** Forget which free models recently failed (used by tests). */
export function resetFreeModelCooldown() {
  cooldown.clear();
}

export function createOpenAICompatible(
  spec: OpenAICompatibleSpec,
): LLMProvider {
  const headersFor = (cfg: ProviderConfig): Record<string, string> => {
    const h: Record<string, string> = { ...spec.extraHeaders };
    if (spec.capabilities.requiresApiKey) {
      h.Authorization = `Bearer ${requireKey(spec.id, cfg.apiKey)}`;
    } else if (cfg.apiKey?.trim()) {
      h.Authorization = `Bearer ${cfg.apiKey.trim()}`;
    }
    return h;
  };
  const baseOf = (cfg: ProviderConfig) => cfg.baseUrl?.trim() || spec.defaultBaseUrl;

  /** One request to one model. `timeoutMs` undefined = the default request timeout. */
  async function callOnce(
    req: VisionRequest,
    cfg: ProviderConfig,
    model: string,
    timeoutMs?: number,
  ): Promise<VisionResponse> {
    const body: Record<string, unknown> = {
      model,
      temperature: req.temperature ?? 0,
      messages: [
        { role: "system", content: req.systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: req.userPrompt },
            ...req.images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
            })),
          ],
        },
      ],
    };
    if (spec.jsonMode) body.response_format = { type: "json_object" };

    let data: ChatCompletion;
    try {
      data = await postJson<ChatCompletion>(
        spec.id,
        joinUrl(baseOf(cfg), "chat/completions"),
        body,
        headersFor(cfg),
        req.signal,
        timeoutMs,
      );
    } catch (e) {
      if (e instanceof ProviderError && e.status === 402) {
        throw new ProviderError(
          `${e.message}\n\nThis account has no credit. Top it up with the provider, or switch to a free option (Gemini or OpenRouter) in Settings.`,
          spec.id,
          402,
        );
      }
      if (e instanceof ProviderError && e.status === 404) {
        throw new ProviderError(
          `${e.message}\n\nThe model "${model}" is unavailable. Choose another model in Settings.`,
          spec.id,
          404,
        );
      }
      throw e;
    }
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError("Empty response from model.", spec.id);
    return {
      status: "complete",
      text,
      providerId: spec.id,
      model: data.model ?? model,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    };
  }

  /**
   * OpenRouter's free auto-router can hand the request to a slow model. Instead, try the
   * current free vision models one after another with a short limit each.
   */
  async function analyzeWithFallback(req: VisionRequest, cfg: ProviderConfig): Promise<VisionResponse> {
    let candidates: string[] = [];
    try {
      candidates = pickFreeModels(await listFreeVisionModels(baseOf(cfg)));
    } catch {
      // Could not list models: fall through to the auto-router below.
    }
    if (!candidates.length) return callOnce(req, cfg, "openrouter/free", 60_000);

    // Models that just failed go to the back of the line instead of costing a full wait again.
    const now = Date.now();
    const cooling = (m: string) => (cooldown.get(m) ?? 0) > now;
    candidates = [...candidates.filter((m) => !cooling(m)), ...candidates.filter(cooling)];

    const errors: string[] = [];
    for (const m of candidates) {
      try {
        return await callOnce(req, cfg, m, 30_000);
      } catch (e) {
        const limited = e instanceof ProviderError && e.status === 429;
        cooldown.set(m, Date.now() + (limited ? 10 : 3) * 60_000);
        if (req.signal?.aborted) throw new ProviderError("Cancelled", spec.id);
        if (e instanceof ProviderError && (e.status === 401 || e.status === 402 || e.status === 403)) throw e;
        errors.push(`${m}: ${(e as Error).message.split("\n")[0].slice(0, 140)}`);
      }
    }
    throw new ProviderError(
      `All free models failed or timed out:\n- ${errors.join("\n- ")}\nTry again later, pick a specific model in Settings, or use Gemini.`,
      spec.id,
    );
  }

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    capabilities: spec.capabilities,
    defaultConfig: { baseUrl: spec.defaultBaseUrl, model: spec.defaultModel },

    async analyze(req: VisionRequest, cfg): Promise<VisionResponse> {
      const model = cfg.model?.trim() || spec.defaultModel;
      if (spec.id === "openrouter" && model === "openrouter/free") {
        return analyzeWithFallback(req, cfg);
      }
      return callOnce(req, cfg, model);
    },

    async testConnection(cfg) {
      const data = await getJson<{ data?: { id: string }[] }>(
        spec.id,
        joinUrl(baseOf(cfg), "models"),
        headersFor(cfg),
      );
      return `OK. ${data.data?.length ?? 0} models visible.`;
    },
  };
}

export const openai = createOpenAICompatible({
  id: "openai",
  label: "OpenAI (GPT-4o Vision)",
  group: "paid-api",
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-4o",
  jsonMode: true,
  capabilities: { vision: true, requiresApiKey: true, local: false },
});

export const openrouter = createOpenAICompatible({
  id: "openrouter",
  label: "OpenRouter (free tier)",
  group: "free-api",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  // Auto-router: OpenRouter picks a currently available free model that accepts images,
  // so this default does not go stale. Pick a specific model in Settings for consistency.
  defaultModel: "openrouter/free",
  capabilities: {
    vision: true,
    requiresApiKey: true,
    local: false,
    notes:
      "Free model IDs rotate. The default 'openrouter/free' auto-selects one; use \"Load free vision models\" to pick a specific model.",
  },
  extraHeaders: { "X-Title": "Grand Strategy Analyzer" },
});

export const deepseek = createOpenAICompatible({
  id: "deepseek",
  label: "DeepSeek API (paid, needs credit)",
  group: "paid-api",
  defaultBaseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-chat",
  jsonMode: true,
  capabilities: {
    vision: true,
    requiresApiKey: true,
    local: false,
    notes:
      "Pay-as-you-go: add credit at platform.deepseek.com or requests fail with 402. Also verify the selected model accepts image input; many DeepSeek endpoints are text-only. For free use pick Gemini or OpenRouter.",
  },
});

export const lmstudio = createOpenAICompatible({
  id: "lmstudio",
  label: "LM Studio / LocalAI (local)",
  group: "local",
  defaultBaseUrl: "http://localhost:1234/v1",
  defaultModel: "local-model",
  capabilities: {
    vision: true,
    requiresApiKey: false,
    local: true,
    notes:
      "LM Studio defaults to :1234. LocalAI defaults to :8080. Load a vision-capable model first.",
  },
});
