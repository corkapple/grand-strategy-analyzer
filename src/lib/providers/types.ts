/**
 * Unified provider contract. Every backend (REST API, local OpenAI-compatible
 * server, browser automation bridge, clipboard fallback) implements LLMProvider
 * and receives the same payload: images (base64) + prompts.
 */

export type ProviderId =
  | "gemini"
  | "openrouter"
  | "groq"
  | "github"
  | "mistral"
  | "mesh"
  | "local"
  | "deepseek"
  | "openai"
  | "anthropic"
  | "ollama"
  | "lmstudio"
  | "browser"
  | "clipboard";

export interface ImageInput {
  /** Raw base64 WITHOUT the `data:...;base64,` prefix. */
  base64: string;
  mimeType: string;
  name?: string;
}

export interface VisionRequest {
  images: ImageInput[];
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface VisionResponse {
  /**
   * `complete`: `text` holds the model reply.
   * `awaiting-manual-response`: a human must paste the reply (clipboard mode);
   * `text` is empty and `manualPrompt` holds what was copied.
   */
  status: "complete" | "awaiting-manual-response";
  text: string;
  providerId: ProviderId;
  model?: string;
  manualPrompt?: string;
  /** Set when a fallback provider answered, e.g. why the main one was skipped. */
  note?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Provider-specific extras, e.g. browser site: "gemini" | "chatgpt" | "deepseek". */
  extra?: Record<string, string>;
}

export interface ProviderCapabilities {
  vision: boolean;
  requiresApiKey: boolean;
  local: boolean;
  /** Cannot read images; only used for text jobs such as reading guides. */
  textOnly?: boolean;
  /** Only reads screenshots (no text-only jobs such as reading guides). */
  imageOnly?: boolean;
  /** Needs a human step (clipboard mode). */
  manual?: boolean;
  /** Shown in the settings drawer under the provider. */
  notes?: string;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly group: "free-api" | "paid-api" | "local" | "no-api";
  readonly capabilities: ProviderCapabilities;
  readonly defaultConfig: ProviderConfig;
  analyze(req: VisionRequest, config: ProviderConfig): Promise<VisionResponse>;
  /** Optional cheap connectivity/auth check for the "Test" button. */
  testConnection?(config: ProviderConfig): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId?: ProviderId,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
