// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/secrets", () => ({
  inTauri: false,
  KEYS_ACCOUNT: "apikeys",
  apiKeyAccount: (id: string) => `apikey:${id}`,
  getSecret: async () => null,
  setSecret: async () => undefined,
}));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("saved settings from an older version", () => {
  const storeName = async () => {
    const { useSettings } = await import("./settings");
    return useSettings;
  };

  it("replaces a retired Groq model that was only ever the old default", async () => {
    const { defaultProviderConfigs } = await import("@/lib/providers/registry");
    const current = defaultProviderConfigs().groq.model;
    const providers = { groq: { model: "meta-llama/llama-4-scout-17b-16e-instruct", apiKey: "k" } };
    // Find the persist key the store uses.
    const useSettings = await storeName();
    const key = (useSettings.persist.getOptions().name as string) ?? "settings";
    localStorage.setItem(key, JSON.stringify({ state: { providers }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().providers.groq.model).toBe(current);
    expect(current).not.toMatch(/llama-4/);
  });
  it("keeps a model the user really chose", async () => {
    const useSettings = await storeName();
    const key = (useSettings.persist.getOptions().name as string) ?? "settings";
    localStorage.setItem(key, JSON.stringify({ state: { providers: { groq: { model: "my-own-model" } } }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().providers.groq.model).toBe("my-own-model");
  });
  it("does not leave a text-only provider (Mesh) as the main provider", async () => {
    const useSettings = await storeName();
    const key = (useSettings.persist.getOptions().name as string) ?? "settings";
    localStorage.setItem(key, JSON.stringify({ state: { activeProvider: "mesh" }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().activeProvider).toBe("gemini");
  });
});
