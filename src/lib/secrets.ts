import { invoke } from "@tauri-apps/api/core";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** OS keychain access (Rust commands `secret_get` / `secret_set`). Throws outside Tauri. */
export async function getSecret(account: string): Promise<string | null> {
  if (!inTauri) throw new Error("OS keychain is only available in the desktop app");
  return invoke<string | null>("secret_get", { account });
}

/** Empty value deletes the entry. */
export async function setSecret(account: string, value: string): Promise<void> {
  if (!inTauri) throw new Error("OS keychain is only available in the desktop app");
  await invoke("secret_set", { account, value });
}

export const apiKeyAccount = (providerId: string) => `apikey:${providerId}`;

/**
 * All API keys live in ONE keychain item (a JSON object). macOS asks for permission per item,
 * and an app without a paid developer signature is asked again for each one, so separate items
 * meant a stream of password prompts.
 */
export const KEYS_ACCOUNT = "apikeys";
