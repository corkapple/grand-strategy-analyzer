import { anthropic } from "./anthropic";
import { browserBridge } from "./browserBridge";
import { clipboardFallback } from "./clipboard";
import { gemini } from "./gemini";
import { deepseek, githubModels, groq, lmstudio, mesh, mistral, openai, openrouter } from "./openaiCompatible";
import { localReader } from "./localReader";
import { ollama } from "./ollama";
import type { LLMProvider, ProviderConfig, ProviderId } from "./types";

export const PROVIDER_LIST: LLMProvider[] = [
  gemini,
  openrouter,
  groq,
  githubModels,
  mistral,
  mesh,
  deepseek,
  openai,
  anthropic,
  ollama,
  lmstudio,
  localReader,
  browserBridge,
  clipboardFallback,
];

const BY_ID = new Map<ProviderId, LLMProvider>(
  PROVIDER_LIST.map((p) => [p.id, p]),
);

export function getProvider(id: ProviderId): LLMProvider {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export function defaultProviderConfigs(): Record<ProviderId, ProviderConfig> {
  return Object.fromEntries(
    PROVIDER_LIST.map((p) => [p.id, { ...p.defaultConfig }]),
  ) as Record<ProviderId, ProviderConfig>;
}
