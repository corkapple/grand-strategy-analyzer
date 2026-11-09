import { getJson, joinUrl, postJson } from "./http";
import { ProviderError, type LLMProvider } from "./types";

const BASE = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2-vision";

interface OllamaChat {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Uses Ollama's native /api/chat (images as raw base64, `format: "json"`). */
export const ollama: LLMProvider = {
  id: "ollama",
  label: "Ollama (local)",
  group: "local",
  capabilities: {
    vision: true,
    requiresApiKey: false,
    local: true,
    notes:
      "Run `ollama pull llama3.2-vision` (or llava) first. Local models are less reliable at reading small numbers; check results.",
  },
  defaultConfig: { baseUrl: BASE, model: DEFAULT_MODEL },

  async analyze(req, cfg) {
    const model = cfg.model?.trim() || DEFAULT_MODEL;
    const data = await postJson<OllamaChat>(
      "ollama",
      joinUrl(cfg.baseUrl?.trim() || BASE, "api/chat"),
      {
        model,
        stream: false,
        format: "json",
        options: { temperature: req.temperature ?? 0 },
        messages: [
          { role: "system", content: req.systemPrompt },
          {
            role: "user",
            content: req.userPrompt,
            images: req.images.map((i) => i.base64),
          },
        ],
      },
      {},
      req.signal,
    );
    const text = data.message?.content;
    if (!text) throw new ProviderError("Empty response from Ollama.", "ollama");
    return {
      status: "complete",
      text,
      providerId: "ollama",
      model,
      usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count },
    };
  },

  async testConnection(cfg) {
    const data = await getJson<{ models?: { name: string }[] }>(
      "ollama",
      joinUrl(cfg.baseUrl?.trim() || BASE, "api/tags"),
    );
    return `OK. Installed: ${data.models?.map((m) => m.name).join(", ") || "none"}`;
  },
};
