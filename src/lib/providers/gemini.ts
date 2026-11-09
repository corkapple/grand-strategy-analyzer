import { getJson, joinUrl, postJson, requireKey } from "./http";
import { ProviderError, type LLMProvider } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export const gemini: LLMProvider = {
  id: "gemini",
  label: "Google Gemini (free tier key)",
  group: "free-api",
  capabilities: {
    vision: true,
    requiresApiKey: true,
    local: false,
    notes:
      "Get a free key at aistudio.google.com. Model name is editable (e.g. gemini-2.5-flash, gemini-2.5-pro).",
  },
  defaultConfig: { baseUrl: BASE, model: DEFAULT_MODEL },

  async analyze(req, cfg) {
    const key = requireKey("gemini", cfg.apiKey);
    const model = cfg.model?.trim() || DEFAULT_MODEL;
    const base = cfg.baseUrl?.trim() || BASE;
    const data = await postJson<GeminiResponse>(
      "gemini",
      joinUrl(base, `models/${model}:generateContent`),
      {
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [
          {
            role: "user",
            parts: [
              { text: req.userPrompt },
              ...req.images.map((i) => ({
                inline_data: { mime_type: i.mimeType, data: i.base64 },
              })),
            ],
          },
        ],
        generationConfig: {
          temperature: req.temperature ?? 0,
          responseMimeType: "application/json",
        },
      },
      { "x-goog-api-key": key },
      req.signal,
    );
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("");
    if (!text) {
      throw new ProviderError(
        data.promptFeedback?.blockReason
          ? `Gemini blocked the request: ${data.promptFeedback.blockReason}`
          : "Empty response from Gemini.",
        "gemini",
      );
    }
    return {
      status: "complete",
      text,
      providerId: "gemini",
      model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  },

  async testConnection(cfg) {
    const key = requireKey("gemini", cfg.apiKey);
    const data = await getJson<{ models?: unknown[] }>(
      "gemini",
      joinUrl(cfg.baseUrl?.trim() || BASE, "models"),
      { "x-goog-api-key": key },
    );
    return `OK. ${data.models?.length ?? 0} models visible.`;
  },
};
