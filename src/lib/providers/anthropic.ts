import { joinUrl, postJson, requireKey } from "./http";
import { ProviderError, type LLMProvider } from "./types";

const BASE = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-sonnet-5-5";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const anthropic: LLMProvider = {
  id: "anthropic",
  label: "Anthropic Claude (Vision)",
  group: "paid-api",
  capabilities: { vision: true, requiresApiKey: true, local: false },
  defaultConfig: { baseUrl: BASE, model: DEFAULT_MODEL },

  async analyze(req, cfg) {
    const key = requireKey("anthropic", cfg.apiKey);
    const model = cfg.model?.trim() || DEFAULT_MODEL;
    const data = await postJson<AnthropicResponse>(
      "anthropic",
      joinUrl(cfg.baseUrl?.trim() || BASE, "messages"),
      {
        model,
        max_tokens: 2048,
        temperature: req.temperature ?? 0,
        system: req.systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              ...req.images.map((i) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: i.mimeType,
                  data: i.base64,
                },
              })),
              { type: "text", text: req.userPrompt },
            ],
          },
        ],
      },
      {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Needed only if the call ever runs from a plain browser (dev mode).
        "anthropic-dangerous-direct-browser-access": "true",
      },
      req.signal,
    );
    const text = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    if (!text) throw new ProviderError("Empty response from Claude.", "anthropic");
    return {
      status: "complete",
      text,
      providerId: "anthropic",
      model,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
    };
  },
};
